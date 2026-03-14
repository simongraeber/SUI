/** Colored dots representing recent win/loss form. */
function FormDots({ form, size = "sm" }: { form: string[]; size?: "sm" | "md" }) {
  if (!form.length) return <span className="text-muted-foreground text-sm">—</span>;
  const dotSize = size === "md" ? "size-3" : "size-2.5";
  const gap = size === "md" ? "gap-1" : "gap-0.5";
  return (
    <div className={`flex ${gap} items-center`}>
      {form.map((r, i) => (
        <span
          key={i}
          className={`inline-block ${dotSize} rounded-full ${
            r === "W"
              ? "bg-green-500"
              : r === "L"
                ? "bg-red-500"
                : "bg-gray-300 dark:bg-gray-600"
          }`}
          title={r === "W" ? "Win" : "Loss"}
        />
      ))}
    </div>
  );
}


export { FormDots };
