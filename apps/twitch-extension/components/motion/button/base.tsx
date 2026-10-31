/** Adapted from beUI Button, MIT, copyright 2026 Saurabh Chauhan.
 * Native CSS press feedback replaces Motion/Tailwind to bound mobile first load.
 * See public/notices/beui-LICENSE.txt. */
import { forwardRef, type ButtonHTMLAttributes } from "react";
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function Button({ className = "", type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={`button ${className}`}
      {...props}
    />
  );
});
