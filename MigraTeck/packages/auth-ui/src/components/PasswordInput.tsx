"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Button } from "./Button";
import { Input } from "./Input";

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      rightSlot={(
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-xl px-2 text-xs"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </Button>
      )}
    />
  );
}
