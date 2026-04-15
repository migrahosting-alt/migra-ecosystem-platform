export function ThemeScript() {
  const script = `
    (function() {
      var key = "migraauth-theme";
      var stored = window.localStorage.getItem(key) || "dark";
      var resolved = stored === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : stored;
      document.documentElement.classList.toggle("dark", resolved === "dark");
      document.documentElement.dataset.theme = resolved;
    })();
  `;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
