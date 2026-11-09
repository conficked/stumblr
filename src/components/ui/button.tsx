import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center rounded-sm text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--toolbar-bg)] focus-visible:ring-[var(--focus-ring)]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--cta)] text-white hover:bg-[var(--cta-hover)]",
        secondary:
          "border border-[color:var(--ui-border)] bg-[color:var(--surface)] text-[var(--text-main)] hover:bg-[color:var(--surface-soft)]",
        ghost:
          "bg-transparent text-[var(--text-main)] hover:bg-[color:var(--surface-soft)]",
        toolbar:
          "bg-transparent text-white hover:bg-white/10",
        danger:
          "border border-[color:var(--ui-border)] text-[var(--text-main)] hover:bg-[color:var(--surface-soft)]",
      },
      size: {
        sm: "h-11 px-3",
        md: "h-11 px-4",
        lg: "h-12 px-5 text-base",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  ),
);

Button.displayName = "Button";
