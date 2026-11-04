import type { ButtonHTMLAttributes } from "react";
import s from "./Button.module.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
  danger?: boolean;
  icon?: boolean;
};

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

export const Button = ({ variant = "default", danger, icon, className, type = "button", ...rest }: Props) => (
  <button
    type={type}
    className={cx(
      s.button,
      variant === "primary" && s.primary,
      variant === "ghost" && s.ghost,
      danger && s.danger,
      icon && s.icon,
      className,
    )}
    {...rest}
  />
);

export { cx };
