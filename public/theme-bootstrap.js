(() => {
  const theme = localStorage.getItem("desk-theme") === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.querySelector("meta[name='theme-color']")?.setAttribute("content", theme === "light" ? "#f6f8fb" : "#05080c");
})();
