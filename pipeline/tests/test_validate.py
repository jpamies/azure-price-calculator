import io
import unittest

from _helpers import make_row, read_rows
from azcalc_pipeline import PipelineError
from azcalc_pipeline.fixture import COLUMNS
from azcalc_pipeline.transform import PRICE, TERM, TYPE, read_prices
from azcalc_pipeline.validate import (
    REQUIRED_COLUMNS,
    Issues,
    check_row_counts,
    map_header,
    normalize_type,
    parse_savings_plan_cell,
    savings_plan_orphans,
)


class HeaderTests(unittest.TestCase):
    def test_missing_headers_are_listed(self) -> None:
        header = [c for c in COLUMNS if c not in ("meterId", "type", "tierMinimumUnits")]
        with self.assertRaises(PipelineError) as ctx:
            map_header(header)
        message = str(ctx.exception)
        for missing in ("meterId", "type", "tierMinimumUnits"):
            self.assertIn(missing, message.split("Found columns")[0])
        self.assertNotIn("retailPrice,", message.split("Found columns")[0])

    def test_columns_mapped_by_name_any_order_and_case(self) -> None:
        header = list(reversed(REQUIRED_COLUMNS))
        header[header.index("retailPrice")] = "RetailPrice"
        header.insert(0, "\ufefflocation")
        columns = map_header(header)
        self.assertEqual(columns.index["retailPrice"], header.index("RetailPrice"))
        self.assertEqual(columns.location, 0)
        self.assertIsNone(columns.savings_plan)

    def test_read_prices_fails_on_missing_header(self) -> None:
        text = ",".join(c for c in COLUMNS if c != "armSkuName") + "\n"
        with self.assertRaisesRegex(PipelineError, "armSkuName"):
            read_prices(io.StringIO(text))

    def test_empty_file(self) -> None:
        with self.assertRaisesRegex(PipelineError, "empty"):
            read_prices(io.StringIO(""))


class TypeAndSavingsPlanTests(unittest.TestCase):
    def test_normalize_type(self) -> None:
        self.assertEqual(normalize_type("SavingsPlan"), "SavingsPlans")
        self.assertEqual(normalize_type("Savings Plan"), "SavingsPlans")
        self.assertEqual(normalize_type("savingsplans"), "SavingsPlans")
        self.assertEqual(normalize_type(" consumption "), "Consumption")
        self.assertEqual(normalize_type("Reservation"), "Reservation")
        self.assertEqual(normalize_type("DevTestConsumption"), "DevTestConsumption")
        self.assertEqual(normalize_type("SomethingNew"), "SomethingNew")

    def test_parse_savings_plan_json_and_python_literal(self) -> None:
        as_json = '[{"unitPrice": 0.0658368, "retailPrice": 0.0658368, "term": "1 Year"}, {"retailPrice": 0.0441792, "term": "3 Years"}]'
        as_literal = "[{'unitPrice': 0.0658368, 'retailPrice': 0.0658368, 'term': '1 Year'}, {'unitPrice': 0.0441792, 'term': '3 Years'}]"
        expected = [(0.0658368, "1 Year"), (0.0441792, "3 Years")]
        self.assertEqual(parse_savings_plan_cell(as_json), expected)
        self.assertEqual(parse_savings_plan_cell(as_literal), expected)

    def test_parse_savings_plan_empty_and_invalid(self) -> None:
        for empty in ("", "nan", "[]", "None"):
            self.assertEqual(parse_savings_plan_cell(empty), [])
        for bad in ("[{'term': '1 Year'}]", "not a list", "[1, 2]", "{'a': __import__('os')}"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_savings_plan_cell(bad)

    def test_nested_savings_plan_column_is_expanded(self) -> None:
        columns = list(COLUMNS) + ["savingsPlan"]
        rows = [
            make_row(savingsPlan='[{"retailPrice": 0.0658368, "unitPrice": 0.0658368, "term": "1 Year"}, '
                                 '{"retailPrice": 0.0441792, "unitPrice": 0.0441792, "term": "3 Years"}]'),
            make_row(meterId="m-2", meterName="D4s v5", skuName="D4s v5", armSkuName="Standard_D4s_v5",
                     retailPrice="0.192", savingsPlan="[{'unitPrice': 0.13, 'retailPrice': 0.13, 'term': '1 Year'}]"),
            make_row(meterId="m-3", meterName="D8s v5", skuName="D8s v5", armSkuName="Standard_D8s_v5",
                     retailPrice="0.384", savingsPlan="garbage["),
        ]
        result = read_rows(rows, columns)
        group = result.main[("Virtual Machines", "eastus")]
        plans = sorted((r[PRICE], r[TERM]) for r in group if r[TYPE] == "SavingsPlans")
        self.assertEqual(plans, sorted([(0.0658368, "1 Year"), (0.0441792, "3 Years"), (0.13, "1 Year")]))
        self.assertEqual(sum(1 for r in group if r[TYPE] == "Consumption"), 3)
        self.assertEqual(result.stats.savings_plan_expanded, 3)
        self.assertEqual(result.stats.savings_plan_errors.count, 1)
        sp_meter_ids = {r[0] for r in group if r[TYPE] == "SavingsPlans" and r[PRICE] in (0.0658368, 0.0441792)}
        self.assertEqual(sp_meter_ids, {"11111111-1111-1111-1111-111111111111"})

    def test_savings_plan_type_variants_are_normalized(self) -> None:
        result = read_rows([make_row(type="Savings Plan", reservationTerm="3 Years", retailPrice="0.0441792")])
        (row,) = result.main[("Virtual Machines", "eastus")]
        self.assertEqual((row[TYPE], row[TERM], row[PRICE]), ("SavingsPlans", "3 Years", 0.0441792))

    def test_savings_plan_orphans(self) -> None:
        def row(sku: str, row_type: str) -> tuple:
            return ("id", sku, "Virtual Machines Dsv5 Series", sku, f"Standard_{sku}", "1 Hour", row_type, "", 0, 1.0, "", 0)

        rows = [row("D2s_v5", "Consumption"), row("D2s_v5", "SavingsPlans"), row("D4s_v5", "SavingsPlans"),
                row("D8s_v5", "Reservation")]
        self.assertEqual(savings_plan_orphans(rows), [("Standard_D4s_v5", "Virtual Machines Dsv5 Series")])


class RowValidationTests(unittest.TestCase):
    def _rows(self, good: int, bad: list[dict]) -> list[dict]:
        return [make_row(meterId=f"m-{i}") for i in range(good)] + bad

    def test_invalid_rows_dropped_within_threshold(self) -> None:
        result = read_rows(self._rows(199, [make_row(retailPrice="n/a")]))
        self.assertEqual(result.stats.rows_read, 200)
        self.assertEqual(result.stats.invalid.count, 1)
        self.assertEqual(len(result.main[("Virtual Machines", "eastus")]), 199)
        check_row_counts(result.stats.rows_read, result.stats.invalid, min_rows=0)

    def test_too_many_invalid_rows_fail(self) -> None:
        bad = [make_row(meterId=""), make_row(serviceName=""), make_row(retailPrice="nan"), make_row(retailPrice="inf")]
        result = read_rows(self._rows(20, bad))
        self.assertEqual(result.stats.invalid.count, 4)
        with self.assertRaisesRegex(PipelineError, "invalid"):
            check_row_counts(result.stats.rows_read, result.stats.invalid, min_rows=0)

    def test_min_rows(self) -> None:
        with self.assertRaisesRegex(PipelineError, "expected at least 900,000"):
            check_row_counts(10, Issues("x"), min_rows=900_000)
        with self.assertRaisesRegex(PipelineError, "no data rows"):
            check_row_counts(0, Issues("x"), min_rows=0)
        check_row_counts(10, Issues("x"), min_rows=10)


if __name__ == "__main__":
    unittest.main()
