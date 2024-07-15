const themeSwitcher = document.getElementById('theme-switcher');
const themeStylesheet = document.getElementById('theme-stylesheet');

// Load saved theme from local storage
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
  themeStylesheet.href = `../../styles/${savedTheme}/bootstrap.min.css`;
  themeSwitcher.value = savedTheme;
}

// Change theme on selection
themeSwitcher.addEventListener('change', function () {
  const selectedTheme = themeSwitcher.value;
  themeStylesheet.href = `../../styles/${selectedTheme}/bootstrap.min.css`;
  // Save selected theme to local storage
  localStorage.setItem('theme', selectedTheme);
});
