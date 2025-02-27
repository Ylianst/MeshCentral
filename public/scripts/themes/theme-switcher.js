document.addEventListener("DOMContentLoaded", function () {
  const themeStylesheet = document.getElementById("theme-stylesheet");

  // Load saved theme from local storage
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme) {
    const safeTheme = ((savedTheme != 'default') ? encodeURIComponent(savedTheme) : encodeURIComponent('..'));
    themeStylesheet.href = `styles/themes/${safeTheme}/bootstrap-min.css`;
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
