/**
 * theme.js - Sistem Manajemen Tema (Mode Terang / Gelap)
 * Politeknik IDN Bogor
 */

// 1. Inisialisasi Dini (dieksekusi langsung di <head> untuk mencegah Flash of Unstyled Theme / FOUC)
(function initEarlyTheme() {
  try {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) {}
})();

// 2. Event Listener DOM Ready untuk Tombol Toggle Tema
document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('themeToggle');

  function updateToggleUI(theme) {
    if (themeToggle) {
      const isDark = theme === 'dark';
      const label = isDark ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap';
      themeToggle.setAttribute('title', label);
      themeToggle.setAttribute('aria-label', label);
    }
  }

  // Sinkronisasi status tombol saat inisialisasi
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  updateToggleUI(currentTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const activeTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = activeTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      try {
        localStorage.setItem('theme', newTheme);
      } catch (e) {}
      updateToggleUI(newTheme);

      // Pancarkan custom event agar halaman (seperti Chart di dashboard) dapat merespons
      window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: newTheme } }));
    });
  }
});
