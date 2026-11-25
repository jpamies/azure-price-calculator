import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SaveAsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
  onSave: (name: string) => void;
}

/** "Save as…": asks for the name of a copy of the current estimate. */
export function SaveAsDialog({ open, onOpenChange, defaultName, onSave }: SaveAsDialogProps) {
  const [name, setName] = useState(defaultName);
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);
  const trimmed = name.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!trimmed) return;
            onSave(trimmed);
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Save as a new estimate</DialogTitle>
            <DialogDescription>Creates a copy with every service and setting. The current estimate is not changed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="save-as-name">Name</Label>
            <Input id="save-as-name" value={name} maxLength={120} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              Save copy
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
