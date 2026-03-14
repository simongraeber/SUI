import { useTransition, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

interface LinkButtonProps extends Omit<ButtonProps, "onClick" | "asChild"> {
  to: string;
  children: ReactNode;
}

export default function LinkButton({ to, children, disabled, className, ...props }: LinkButtonProps) {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      disabled={disabled}
      onClick={() => {
        if (isPending) return;
        startTransition(() => navigate(to));
      }}
      className={cn(className, isPending && "animate-pulse")}
      {...props}
    >
      {children}
    </Button>
  );
}
