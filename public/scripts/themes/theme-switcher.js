// Apply theme explicitly and load Google Fonts asynchronously
window.applyMeshTheme = function(url) {
  var themeLink = document.getElementById('theme-stylesheet');
  var themeStyle = document.getElementById('theme-style-block');
  if (!themeLink && !themeStyle) return;

  var isDefault = url.indexOf('..') !== -1;
  var fontsLink = document.getElementById('theme-fonts');
  if (!isDefault) {
    if (!fontsLink) {
      fontsLink = document.createElement('link');
      fontsLink.id = 'theme-fonts';
      fontsLink.rel = 'stylesheet';
      fontsLink.href = 'styles/fonts/fonts.css';
      document.head.appendChild(fontsLink);
    }
  } else {
    if (fontsLink) {
      fontsLink.parentNode.removeChild(fontsLink);
    }
  }

  if (!window.fetch) {
    if (themeLink) { themeLink.disabled = false; themeLink.href = url; }
    if (themeStyle) { themeStyle.disabled = true; }
    return;
  }

  fetch(url)
    .then(function(response) { return response.text(); })
    .then(function(css) {
      // Strip out the Google Fonts import entirely so it falls back to fonts.css
      css = css.replace(/@import\s+(?:url\()?['"]?(https?:\/\/fonts\.googleapis\.com[^)'"]*)['"]?\)?\s*;?/gi, '');

      if (!themeStyle) {
        themeStyle = document.createElement('style');
        themeStyle.id = 'theme-style-block';
        if (themeLink) {
          themeLink.parentNode.insertBefore(themeStyle, themeLink.nextSibling);
        } else {
          document.head.appendChild(themeStyle);
        }
      }
      themeStyle.textContent = css;
      themeStyle.disabled = false;
      if (themeLink) themeLink.disabled = true;
    })
    .catch(function() {
      if (themeLink) { themeLink.disabled = false; themeLink.href = url; }
      if (themeStyle) { themeStyle.disabled = true; }
    });
};

document.addEventListener("DOMContentLoaded", function () {
  // Load saved theme from local storage
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme) {
    const safeTheme = ((savedTheme != 'default') ? encodeURIComponent(savedTheme) : encodeURIComponent('..'));
    window.applyMeshTheme(`styles/themes/${safeTheme}/bootstrap-min.css`);
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
