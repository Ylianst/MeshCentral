var MeshCentralTheme = (function () {
  var darkBaseThemes = { cyborg: true, darkly: true, solar: true, vapor: true };

  /**
   * Return a safe theme key for storage, comparisons, and stylesheet paths.
   * Valid theme names are lowercased, for example "Materia" becomes "materia".
   * Missing, non-string, or unsafe values return "default".
   *
   * @param {string} theme Theme name selected by the user or loaded from localStorage.
   * @returns {string} Normalized theme key, or "default" when the input is invalid.
   */
  function normalizeTheme(theme) {
    if ((typeof theme !== "string") || !/^[a-z0-9_-]+$/i.test(theme)) return "default";
    return theme.toLowerCase();
  }

  // Build the Bootswatch stylesheet URL for a normalized theme key.
  function getThemeHref(theme) {
    var normalizedTheme = normalizeTheme(theme);
    var safeTheme = (normalizedTheme != "default") ? encodeURIComponent(normalizedTheme) : encodeURIComponent("..");
    return "styles/themes/" + safeTheme + "/bootstrap-min.css";
  }

  // Identify Bootswatch themes whose base palette is dark even before night mode.
  function isDarkBaseTheme(theme) {
    return darkBaseThemes[normalizeTheme(theme)] === true;
  }

  // Apply the selected theme stylesheet to the active page.
  function applyTheme(theme) {
    var themeStylesheet = document.getElementById("theme-stylesheet");
    if (themeStylesheet) themeStylesheet.href = getThemeHref(theme);
  }

  return {
    normalizeTheme: normalizeTheme,
    getThemeHref: getThemeHref,
    isDarkBaseTheme: isDarkBaseTheme,
    applyTheme: applyTheme
  };
})();

document.addEventListener("DOMContentLoaded", function () {

  // Load saved theme from local storage
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme) {
    MeshCentralTheme.applyTheme(savedTheme);
  }

  // Initialize Select2 on all select elements with the 'select2' class
  $(".select2").select2({
    theme: "bootstrap-5",
    width: $(this).data("width")
      ? $(this).data("width")
      : $(this).hasClass("w-100")
      ? "100%"
      : "style",
    placeholder: $(this).data("placeholder"),
  });
});
