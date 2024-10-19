document.addEventListener('DOMContentLoaded', function () {

  const themeSwitcher = document.getElementById('theme-switcher');
  const themeStylesheet = document.getElementById('theme-stylesheet');

  // Load saved theme from local storage
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    const safeTheme = encodeURIComponent(savedTheme);
    themeStylesheet.href = `styles/themes/${safeTheme}/bootstrap.min.css`;
    themeSwitcher.value = savedTheme;
  }

  // Change theme on selection
  themeSwitcher.addEventListener('change', function () {
    const selectedTheme = themeSwitcher.value;
    const safeTheme = encodeURIComponent(selectedTheme);
    themeStylesheet.href = `styles/themes/${safeTheme}/bootstrap.min.css`;
    // Save selected theme to local storage
    localStorage.setItem('theme', selectedTheme);
  });

  // Initialize Select2 on all select elements with the 'select2' class
  $('.select2').select2({
    theme: 'bootstrap-5',
    width: $( this ).data( 'width' ) ? $( this ).data( 'width' ) : $( this ).hasClass( 'w-100' ) ? '100%' : 'style',
    placeholder: $( this ).data( 'placeholder' ),
  });
});
