/**
 * dashboard.js - Logika Monitoring & Dashboard Absensi Dosen
 * Politeknik IDN Bogor
 */

// ====== KONFIGURASI ======
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby8f0xPX9qMO8eJpaF6XTtzOz8XjCOPJdrGB1LAdzeWGlSAFfN3QJvJl5C8c5Yksfcz/exec';
const SECRET_KEY = 'absensidosenpidnb2026';

let semuaData = [];
let chartStatus = null;
let chartMatkul = null;

// State Admin & PIN (Dinamis dari Sheet Matkul)
let isAdminLoggedIn = false;
let savedAdminPin = '';
let daftarAdminPasswords = [];
let dosenPasswordsMap = {};
let masterFetchPromise = null;

function cariPinDosen(namaDosen) {
  if (!namaDosen) return '';
  const target = String(namaDosen).trim();
  if (dosenPasswordsMap[target]) return dosenPasswordsMap[target];

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetNorm = norm(target);

  for (const d in dosenPasswordsMap) {
    if (norm(d) === targetNorm) return dosenPasswordsMap[d];
  }

  for (const d in dosenPasswordsMap) {
    const dNorm = norm(d);
    if (dNorm.startsWith(targetNorm.slice(0, 10)) || targetNorm.startsWith(dNorm.slice(0, 10))) {
      return dosenPasswordsMap[d];
    }
  }

  return '';
}

// Fallback map SKS berdasarkan sheet Matkul (tanpa ubah sheet Absensi)
const FALLBACK_SKS = {
  'RPL-250101': 3, 'RPL-250102': 3, 'RPL-250103': 3, 'RPL-250104': 3, 'RPL-250105': 4, 'RPL-250106': 4,
  'RMG-250101': 3, 'RMG-250102': 3, 'RMG-250103': 3, 'RMG-250104': 4, 'RMG-250105': 4, 'RMG-250106': 3,
  'RKJ-250101': 3, 'RKJ-250102': 3, 'RKJ-250103': 3, 'RKJ-250104': 4, 'RKJ-250105': 4, 'RKJ-250106': 3
};
let mapSks = { ...FALLBACK_SKS };
let dashboardCurrentPage = 1;
let dashboardPageSize = 10;

function getSks(kode, nama) {
  if (kode && mapSks[kode]) return mapSks[kode];
  if (nama && mapSks[nama]) return mapSks[nama];
  for (const k in mapSks) {
    if (nama && nama.toLowerCase().includes(k.toLowerCase())) return mapSks[k];
  }
  return 3;
}

// Brand Color Palette: #0a62e8 (Primary), #ffcd27 (Amber), #fb7470 (Coral Red)
const WARNA_STATUS = {
  'Hadir': '#0a62e8',       // Vibrant Blue (Brand Primary)
  'Terlambat': '#ffcd27',   // Golden Amber
  'Izin': '#38bdf8',        // Sky Blue
  'Sakit': '#a855f7',       // Purple
  'Tidak Hadir': '#fb7470'  // Coral Red
};

function esc(teks) {
  const div = document.createElement('div');
  div.textContent = teks ?? '';
  return div.innerHTML;
}

function formatTanggal(raw) {
  if (!raw) return '-';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [y, m, d] = trimmed.split('-');
      const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      return parseInt(d, 10) + ' ' + bulan[parseInt(m, 10) - 1] + ' ' + y;
    }
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) return esc(raw);
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return d.getDate() + ' ' + bulan[d.getMonth()] + ' ' + d.getFullYear();
}

function parseTimestamp(raw) {
  if (!raw) return 0;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const [y, m, d] = raw.trim().split('-');
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)).getTime();
  }
  const time = new Date(raw).getTime();
  return isNaN(time) ? 0 : time;
}

function hitungPerKunci(data, kunci) {
  return data.reduce((acc, item) => {
    const nilai = item[kunci] || '-';
    acc[nilai] = (acc[nilai] || 0) + 1;
    return acc;
  }, {});
}

function syncChartDefaults() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = isDark ? '#94A3B8' : '#64748B';
    Chart.defaults.borderColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
    Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  }
}

// Respon perubahan tema dari theme.js
window.addEventListener('themeChanged', () => {
  if (semuaData && semuaData.length > 0) {
    render();
  }
});

// ====== SINKRONISASI MASTER PASSWORD & SKS DARI SPREADSHEET ======
async function ambilMasterPasswords() {
  try {
    const res = await fetch(SCRIPT_URL + '?action=master');
    const mJson = await res.json();
    if (mJson && mJson.status === 'ok') {
      // 1. Password Admin murni dari Spreadsheet Kolom J
      const sandiAdmin = [];
      if (mJson.passwords && Array.isArray(mJson.passwords)) {
        sandiAdmin.push(...mJson.passwords);
      }
      if (mJson.password) {
        sandiAdmin.push(mJson.password);
      }
      daftarAdminPasswords = [...new Set(sandiAdmin.map(p => String(p).trim()).filter(Boolean))];

      // 2. PIN Dosen murni dari Spreadsheet Kolom L & M
      if (mJson.dosenPasswords && typeof mJson.dosenPasswords === 'object') {
        dosenPasswordsMap = { ...mJson.dosenPasswords };
      }

      if (mJson.matkul && Array.isArray(mJson.matkul)) {
        mJson.matkul.forEach(m => {
          const sVal = parseInt(m.sks, 10);
          if (sVal > 0) {
            if (m.kode) mapSks[m.kode] = sVal;
            if (m.nama) mapSks[m.nama] = sVal;
          }
        });
      }
      return true;
    }
  } catch (err) {
    console.warn('Gagal memuat master data password dari Apps Script:', err);
  }
  return false;
}

// Muat master password secepat mungkin di background
masterFetchPromise = ambilMasterPasswords();

// ====== MANAJEMEN SESI & AUTH ADMIN (KOLOM J) ======
const btnAdminLogin = document.getElementById('btnAdminLogin');
const btnAdminLogout = document.getElementById('btnAdminLogout');
const adminBadgeWrap = document.getElementById('adminBadgeWrap');
const modalAdminAuth = document.getElementById('modalAdminAuth');
const btnCloseAdminModal = document.getElementById('btnCloseAdminModal');
const btnCancelAdminAuth = document.getElementById('btnCancelAdminAuth');
const formAdminAuth = document.getElementById('formAdminAuth');
const inputAdminPin = document.getElementById('inputAdminPin');
const toggleAdminPin = document.getElementById('toggleAdminPin');
const eyeAdminIcon = document.getElementById('eyeAdminIcon');
const adminAuthAlert = document.getElementById('adminAuthAlert');
const btnSubmitAdminAuth = document.getElementById('btnSubmitAdminAuth');

function updateAdminUI(isAdmin) {
  if (btnAdminLogin) btnAdminLogin.style.display = isAdmin ? 'none' : 'inline-flex';
  if (adminBadgeWrap) adminBadgeWrap.style.display = isAdmin ? 'inline-flex' : 'none';
}

function checkAdminSession() {
  try {
    const auth = sessionStorage.getItem('dashboard_admin_auth');
    const pin = sessionStorage.getItem('dashboard_admin_pin');
    if (auth === 'true' && pin) {
      isAdminLoggedIn = true;
      savedAdminPin = pin;
      updateAdminUI(true);
    } else {
      isAdminLoggedIn = false;
      savedAdminPin = '';
      updateAdminUI(false);
    }
  } catch (e) {
    isAdminLoggedIn = false;
    updateAdminUI(false);
  }
}

function bukaModalAdminAuth() {
  if (modalAdminAuth) {
    modalAdminAuth.classList.add('active');
    if (inputAdminPin) {
      inputAdminPin.value = '';
      setTimeout(() => inputAdminPin.focus(), 150);
    }
    if (adminAuthAlert) {
      adminAuthAlert.className = 'lock-alert';
      adminAuthAlert.style.display = 'none';
      adminAuthAlert.textContent = '';
    }
  }
}

function tutupModalAdminAuth() {
  if (modalAdminAuth) {
    modalAdminAuth.classList.remove('active');
  }
}

function logoutAdmin() {
  try {
    sessionStorage.removeItem('dashboard_admin_auth');
    sessionStorage.removeItem('dashboard_admin_pin');
  } catch (e) {}
  isAdminLoggedIn = false;
  savedAdminPin = '';
  updateAdminUI(false);
  render();
}

if (btnAdminLogin) btnAdminLogin.addEventListener('click', bukaModalAdminAuth);
if (btnAdminLogout) btnAdminLogout.addEventListener('click', logoutAdmin);
if (btnCloseAdminModal) btnCloseAdminModal.addEventListener('click', tutupModalAdminAuth);
if (btnCancelAdminAuth) btnCancelAdminAuth.addEventListener('click', tutupModalAdminAuth);
if (modalAdminAuth) {
  modalAdminAuth.addEventListener('click', (e) => {
    if (e.target === modalAdminAuth) tutupModalAdminAuth();
  });
}

if (toggleAdminPin && inputAdminPin) {
  toggleAdminPin.addEventListener('click', () => {
    const isPass = inputAdminPin.getAttribute('type') === 'password';
    inputAdminPin.setAttribute('type', isPass ? 'text' : 'password');
    if (eyeAdminIcon) {
      eyeAdminIcon.innerHTML = isPass ?
        '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>' :
        '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
    }
  });
}

if (formAdminAuth && inputAdminPin) {
  formAdminAuth.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = inputAdminPin.value.trim();
    if (!pin) return;

    if (btnSubmitAdminAuth) {
      btnSubmitAdminAuth.disabled = true;
      btnSubmitAdminAuth.textContent = 'Memvalidasi...';
    }

    if (masterFetchPromise) {
      await masterFetchPromise;
    } else {
      await ambilMasterPasswords();
    }

    const cocok = daftarAdminPasswords.some(p => {
      const strP = String(p).trim();
      return strP === pin || strP.toLowerCase() === pin.toLowerCase();
    });

    if (btnSubmitAdminAuth) {
      btnSubmitAdminAuth.disabled = false;
      btnSubmitAdminAuth.textContent = 'Masuk Admin';
    }

    if (cocok) {
      try {
        sessionStorage.setItem('dashboard_admin_auth', 'true');
        sessionStorage.setItem('dashboard_admin_pin', pin);
      } catch (e) {}
      isAdminLoggedIn = true;
      savedAdminPin = pin;
      updateAdminUI(true);
      tutupModalAdminAuth();
      render();
    } else {
      if (adminAuthAlert) {
        adminAuthAlert.className = 'lock-alert err';
        adminAuthAlert.style.display = 'block';
        adminAuthAlert.innerHTML = '<strong>PIN salah.</strong> Silakan coba lagi.';
      }
      inputAdminPin.focus();
    }
  });
}

function isiFilters() {
  // 1. Populasi Filter Dosen
  const selDosen = document.getElementById('filterDosen');
  const wrapDosen = selDosen ? selDosen.closest('.filter-dropdown-wrap') : null;
  if (selDosen) {
    selDosen.innerHTML = '<option value="">Semua Dosen</option>';
    const daftarDosen = [...new Set(semuaData.map(d => d.dosen).filter(Boolean))].sort();
    daftarDosen.forEach(nama => {
      const opt = document.createElement('option');
      opt.value = nama;
      opt.textContent = nama;
      selDosen.appendChild(opt);
    });
    selDosen.addEventListener('change', () => {
      dashboardCurrentPage = 1;
      if (wrapDosen) {
        wrapDosen.classList.toggle('has-filter', Boolean(selDosen.value));
      }
      render();
    });
  }

  // 2. Populasi Filter Semester
  const selSem = document.getElementById('filterSemester');
  const wrapSem = selSem ? selSem.closest('.filter-dropdown-wrap') : null;
  if (selSem) {
    selSem.innerHTML = '<option value="">Semua Semester</option>';
    const daftarSem = [...new Set(semuaData.map(d => d.semester).filter(s => s && s !== '-'))]
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    daftarSem.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = 'Semester ' + s;
      selSem.appendChild(opt);
    });
    selSem.addEventListener('change', () => {
      dashboardCurrentPage = 1;
      if (wrapSem) {
        wrapSem.classList.toggle('has-filter', Boolean(selSem.value));
      }
      render();
    });
  }

  // 3. Populasi Filter Metode
  const selMetode = document.getElementById('filterMetode');
  const wrapMetode = selMetode ? selMetode.closest('.filter-dropdown-wrap') : null;
  if (selMetode) {
    selMetode.innerHTML = '<option value="">Semua Metode</option>' +
      ['Offline', 'Online', 'Hybrid'].map(m => `<option value="${m}">${m}</option>`).join('');
    selMetode.addEventListener('change', () => {
      dashboardCurrentPage = 1;
      if (wrapMetode) {
        wrapMetode.classList.toggle('has-filter', Boolean(selMetode.value));
      }
      render();
    });
  }
}

function render() {
  syncChartDefaults();
  const selDosen = document.getElementById('filterDosen');
  const selSem = document.getElementById('filterSemester');
  const selMetode = document.getElementById('filterMetode');
  const dosen = selDosen ? selDosen.value : '';
  const semester = selSem ? selSem.value : '';
  const metode = selMetode ? selMetode.value : '';

  const wrapDosen = selDosen ? selDosen.closest('.filter-dropdown-wrap') : null;
  const wrapSem = selSem ? selSem.closest('.filter-dropdown-wrap') : null;
  const wrapMetode = selMetode ? selMetode.closest('.filter-dropdown-wrap') : null;
  if (wrapDosen) wrapDosen.classList.toggle('has-filter', Boolean(dosen));
  if (wrapSem) wrapSem.classList.toggle('has-filter', Boolean(semester));
  if (wrapMetode) wrapMetode.classList.toggle('has-filter', Boolean(metode));

  // Filter data berdasarkan dosen, semester, dan metode
  const data = semuaData.filter(d => {
    const cocokDosen = !dosen || d.dosen === dosen;
    const cocokSem = !semester || String(d.semester) === String(semester);
    const cocokMetode = !metode || String(d.metode).toLowerCase() === metode.toLowerCase();
    return cocokDosen && cocokSem && cocokMetode;
  });

  // KPI
  const total = data.length;
  const hadir = data.filter(d => d.statusKehadiran === 'Hadir').length;
  const pending = data.filter(d => (d.statusVerifikasi || '').toLowerCase() !== 'terverifikasi').length;
  const matkulUnik = new Set(data.map(d => d.mataKuliah)).size;

  const elKpiTotal = document.getElementById('kpiTotal');
  const elKpiHadir = document.getElementById('kpiHadir');
  const elKpiPending = document.getElementById('kpiPending');
  const elKpiMatkul = document.getElementById('kpiMatkul');

  if (elKpiTotal) elKpiTotal.textContent = total;
  if (elKpiHadir) elKpiHadir.textContent = total ? Math.round((hadir / total) * 100) + '%' : '0%';
  if (elKpiPending) elKpiPending.textContent = pending;
  if (elKpiMatkul) elKpiMatkul.textContent = matkulUnik;

  // Grafik status kehadiran (Doughnut Ring with 72% Cutout)
  const elChartStatus = document.getElementById('chartStatus');
  if (elChartStatus && typeof Chart !== 'undefined') {
    const perStatus = hitungPerKunci(data, 'statusKehadiran');
    if (chartStatus) chartStatus.destroy();
    chartStatus = new Chart(elChartStatus, {
      type: 'doughnut',
      data: {
        labels: Object.keys(perStatus),
        datasets: [{
          data: Object.values(perStatus),
          backgroundColor: Object.keys(perStatus).map(s => WARNA_STATUS[s] || '#98a2b3'),
          borderWidth: 3,
          borderColor: document.documentElement.getAttribute('data-theme') === 'dark' ? '#111A2E' : '#FFFFFF',
          hoverOffset: 4
        }]
      },
      options: { 
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: { 
          legend: { 
            position: 'bottom',
            labels: {
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle',
              font: {
                size: 12,
                weight: '600'
              }
            }
          } 
        } 
      }
    });
  }

  // Grafik pertemuan per mata kuliah, ditumpuk per status
  const elChartMatkul = document.getElementById('chartMatkul');
  if (elChartMatkul && typeof Chart !== 'undefined') {
    const matkulList = [...new Set(data.map(d => d.mataKuliah))];
    const statusList = [...new Set(data.map(d => d.statusKehadiran))];
    const datasets = statusList.map(status => ({
      label: status,
      data: matkulList.map(mk => data.filter(d => d.mataKuliah === mk && d.statusKehadiran === status).length),
      backgroundColor: WARNA_STATUS[status] || '#98a2b3',
      borderRadius: 6
    }));
    if (chartMatkul) chartMatkul.destroy();
    chartMatkul = new Chart(elChartMatkul, {
      type: 'bar',
      data: { labels: matkulList, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { 
          x: { 
            stacked: true,
            grid: { display: false }
          }, 
          y: { 
            stacked: true, 
            beginAtZero: true, 
            ticks: { precision: 0 } 
          } 
        },
        plugins: { 
          legend: { 
            position: 'bottom',
            labels: {
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle',
              font: {
                size: 12,
                weight: '600'
              }
            }
          } 
        }
      }
    });
  }

  // Tabel riwayat absensi dengan pagination dropdown
  const elTabelBody = document.getElementById('tabelBody');
  const elPagination = document.getElementById('paginationDashboard');

  if (elTabelBody) {
    const sortedData = [...data].sort((a, b) => parseTimestamp(b.tanggal) - parseTimestamp(a.tanggal));
    const totalData = sortedData.length;
    const totalPages = Math.ceil(totalData / dashboardPageSize) || 1;

    if (dashboardCurrentPage > totalPages) dashboardCurrentPage = totalPages;
    if (dashboardCurrentPage < 1) dashboardCurrentPage = 1;

    const startIndex = (dashboardCurrentPage - 1) * dashboardPageSize;
    const endIndex = Math.min(startIndex + dashboardPageSize, totalData);
    const pageData = sortedData.slice(startIndex, endIndex);

    if (totalData === 0) {
      elTabelBody.innerHTML = '<tr><td colspan="13" class="pesan" style="border:none;box-shadow:none;">Belum ada data absensi</td></tr>';
      if (elPagination) elPagination.style.display = 'none';
    } else {
      elTabelBody.innerHTML = pageData.map(d => {
        const mLow = String(d.metode || '').toLowerCase();
        const badgeMetode = mLow === 'offline' ? 'metode-offline' : (mLow === 'online' ? 'metode-online' : (mLow === 'hybrid' ? 'metode-hybrid' : ''));

        const link = (d.linkMateri || d.materi || '').trim();
        let materiHtml = '-';
        if (link) {
          if (/^https?:\/\//i.test(link)) {
            materiHtml = `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="link-materi-btn" title="Buka tautan materi perkuliahan">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              <span>Buka Materi</span>
            </a>`;
          } else {
            materiHtml = `<span title="${esc(link)}">${esc(link)}</span>`;
          }
        }

        const linkBukti = (d.buktiKelas || d.bukti || d.linkBukti || '').trim();
        let buktiHtml = '-';
        if (linkBukti && linkBukti !== '-') {
          buktiHtml = `<button type="button" class="link-materi-btn" title="Klik untuk melihat bukti foto kelas langsung" onclick="tampilkanBukti('${esc(linkBukti)}', '${esc(d.dosen)}', '${esc(d.mataKuliah)}', ${d.pertemuan}, '${esc(d.tanggal)}')">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span>Lihat Foto</span>
          </button>`;
        }

        const sksNilai = getSks(d.kodeMatkul, d.mataKuliah);
        const statusVerifLower = (d.statusVerifikasi || '').toLowerCase();
        const isVerif = statusVerifLower.includes('terverifikasi');
        const isDitolak = statusVerifLower.includes('ditolak');
        const isProses = d.statusVerifikasi === 'Memproses...';
        const catatan = (d.catatanPenolakan || d.catatan || d.catatanAdmin || '').trim();

        // 1. Kolom Verifikasi
        let verifBtnHtml = '';
        if (!isAdminLoggedIn) {
          // Mode Publik / Dosen: Read-only badge
          if (isVerif) {
            verifBtnHtml = `<span class="badge ok" title="Sudah diverifikasi oleh Admin">✓ Terverifikasi</span>`;
          } else if (isDitolak) {
            verifBtnHtml = `<div style="display:flex; flex-direction:column; align-items:flex-start;">
              <span class="badge err" title="Absensi Ditolak">✕ Ditolak</span>
              ${catatan ? `<button type="button" class="btn-catatan-tag" title="Klik untuk membaca catatan penolakan dari admin" onclick="lihatCatatanPenolakan('${esc(d.dosen)}', '${esc(d.mataKuliah)}', ${d.pertemuan}, '${esc(catatan)}')">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <span>Catatan</span>
              </button>` : ''}
            </div>`;
          } else {
            verifBtnHtml = `<span class="badge warn" title="Menunggu verifikasi oleh Admin">Menunggu Verifikasi</span>`;
          }
        } else {
          // Mode Admin: Interaktif
          if (isProses) {
            verifBtnHtml = `<span class="badge warn">Memproses...</span>`;
          } else if (isVerif) {
            verifBtnHtml = `<button type="button" class="badge-verif-btn ok" title="Sudah Terverifikasi. Klik untuk membatalkan atau menolak" onclick="bukaDialogAdminVerif(${d.no}, '${esc(d.kodeMatkul)}', ${d.pertemuan})">✓ Terverifikasi</button>`;
          } else if (isDitolak) {
            verifBtnHtml = `<div style="display:flex; flex-direction:column; align-items:flex-start;">
              <button type="button" class="badge-verif-btn err" title="Status Ditolak. Klik untuk ubah status atau catatan" onclick="bukaDialogAdminVerif(${d.no}, '${esc(d.kodeMatkul)}', ${d.pertemuan})">✕ Ditolak</button>
              ${catatan ? `<button type="button" class="btn-catatan-tag" title="Klik untuk melihat catatan penolakan" onclick="lihatCatatanPenolakan('${esc(d.dosen)}', '${esc(d.mataKuliah)}', ${d.pertemuan}, '${esc(catatan)}')">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <span>Catatan</span>
              </button>` : ''}
            </div>`;
          } else {
            verifBtnHtml = `<div class="admin-verif-group">
              <button type="button" class="btn-verif-action" title="Setujui dan Verifikasi Kehadiran" onclick="verifikasiKehadiran(${d.no}, '${esc(d.kodeMatkul)}', ${d.pertemuan}, 'Terverifikasi')">✓ Setujui</button>
              <button type="button" class="btn-tolak-action" title="Tolak Absensi dengan Catatan" onclick="tolakKehadiranDenganCatatan(${d.no}, '${esc(d.kodeMatkul)}', ${d.pertemuan})">✕ Tolak</button>
            </div>`;
          }
        }

        // Tombol Struk Transportasi Khusus Mode Admin (berbarengan dengan tombol verifikasi)
        let verifCellHtml = verifBtnHtml;
        if (isAdminLoggedIn) {
          const linkStruk = (d.linkStrukTransport || d.linkStruk || d.struk || d['Link Struk Transportasi'] || '').trim();
          const nominalRaw = (d.nominalTransport || d.biayaTransport || d['Nominal Transportasi'] || '').toString().trim();
          let labelStruk = 'Struk Transport';
          if (nominalRaw && !isNaN(nominalRaw) && Number(nominalRaw) > 0) {
            labelStruk = `Struk (Rp ${Number(nominalRaw).toLocaleString('id-ID')})`;
          }

          if (linkStruk && linkStruk !== '-') {
            const strukBtnHtml = `<button type="button" class="btn-struk-admin" title="Klik untuk memeriksa bukti struk transportasi dosen" onclick="tampilkanBukti('${esc(linkStruk)}', '${esc(d.dosen)}', 'Struk Transportasi • ${esc(labelStruk)} • ${esc(d.mataKuliah)}', ${d.pertemuan}, '${esc(d.tanggal)}')">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="18" x2="12" y2="12"></line>
                <line x1="9" y1="15" x2="15" y2="15"></line>
              </svg>
              <span>${esc(labelStruk)}</span>
            </button>`;

            verifCellHtml = `<div class="verif-cell-admin">
              ${verifBtnHtml}
              ${strukBtnHtml}
            </div>`;
          }
        }

        // 2. Kolom Aksi (Tombol Edit / Revisi Absensi)
        let aksiCellHtml = '';
        if (isVerif) {
          aksiCellHtml = `<button type="button" class="btn-edit-absensi disabled" disabled title="Terkunci: Absensi sudah terverifikasi dan tidak dapat diedit">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <span>Edit</span>
          </button>`;
        } else {
          aksiCellHtml = `<button type="button" class="btn-edit-absensi" title="${isDitolak ? 'Revisi dan perbaiki absensi ini' : 'Edit data absensi'}" onclick="mulaiEditAbsensi(${d.no}, '${esc(d.kodeMatkul)}', ${d.pertemuan})">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <span>${isDitolak ? 'Revisi' : 'Edit'}</span>
          </button>`;
        }

        return `<tr>
          <td>${formatTanggal(d.tanggal)}</td>
          <td><strong>${esc(d.dosen)}</strong></td>
          <td><span class="badge semester">Sem ${esc(d.semester || '-')}</span></td>
          <td>
            <div class="matkul-cell">
              <strong>${esc(d.mataKuliah || '-')}</strong>
              ${d.kodeMatkul && d.kodeMatkul !== '-' ? `<span class="sub-kode">${esc(d.kodeMatkul)}</span>` : ''}
            </div>
          </td>
          <td style="text-align:center;"><span class="badge semester">${sksNilai} SKS</span></td>
          <td>Pertemuan ${esc(d.pertemuan)}</td>
          <td><span class="badge ${badgeMetode}">${esc(d.metode || '-')}</span></td>
          <td>${esc(d.lokasi || '-')}</td>
          <td>${materiHtml}</td>
          <td style="text-align:center;">${buktiHtml}</td>
          <td>${esc(d.statusKehadiran)}</td>
          <td>${verifCellHtml}</td>
          <td style="text-align:center;">${aksiCellHtml}</td>
        </tr>`;
      }).join('');

      renderDropdownPagination('paginationDashboard', dashboardCurrentPage, totalPages, totalData, dashboardPageSize, 'gantiHalamanDashboard', 'gantiBarisDashboard', 'data');
    }
  }
}

// ====== MODAL PRATINJAU BUKTI KELAS ======
const modalBukti = document.getElementById('modalBukti');
const btnCloseBukti = document.getElementById('btnCloseBukti');
const btnBatalBukti = document.getElementById('btnBatalBukti');
const modalBuktiImg = document.getElementById('modalBuktiImg');
const modalBuktiLoading = document.getElementById('modalBuktiLoading');
const modalBuktiMeta = document.getElementById('modalBuktiMeta');
const modalBuktiExtLink = document.getElementById('modalBuktiExtLink');

function tutupModalBukti() {
  if (modalBukti) {
    modalBukti.classList.remove('active');
    if (modalBuktiImg) modalBuktiImg.src = '';
  }
}

if (btnCloseBukti) btnCloseBukti.addEventListener('click', tutupModalBukti);
if (btnBatalBukti) btnBatalBukti.addEventListener('click', tutupModalBukti);
if (modalBukti) {
  modalBukti.addEventListener('click', (e) => {
    if (e.target === modalBukti) tutupModalBukti();
  });
}

function getDriveThumbUrl(url) {
  if (!url) return '';
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1200`;
  }
  return url;
}

function tampilkanBukti(url, dosen, matkul, pertemuan, tanggal) {
  if (!url || !modalBukti) return;
  if (modalBuktiMeta) {
    modalBuktiMeta.innerHTML = `<strong>${esc(dosen)}</strong> • ${esc(matkul)} (Pertemuan ${esc(pertemuan)})<br><span style="color:var(--text-muted);font-size:12px;">Tanggal: ${formatTanggal(tanggal)}</span>`;
  }

  if (modalBuktiLoading) modalBuktiLoading.style.display = 'inline-block';
  if (modalBuktiImg) {
    modalBuktiImg.style.display = 'none';

    const directSrc = getDriveThumbUrl(url);
    modalBuktiImg.onload = () => {
      if (modalBuktiLoading) modalBuktiLoading.style.display = 'none';
      modalBuktiImg.style.display = 'block';
    };
    modalBuktiImg.onerror = () => {
      if (modalBuktiLoading) modalBuktiLoading.style.display = 'none';
      modalBuktiImg.style.display = 'block';
      modalBuktiImg.alt = 'Gagal memuat pratinjau gambar';
    };
    modalBuktiImg.src = directSrc;
  }
  if (modalBuktiExtLink) modalBuktiExtLink.href = url;

  modalBukti.classList.add('active');
}

// ====== HELPER RENDER DROPDOWN PAGINATION ATTENAD ======
function renderDropdownPagination(containerId, currentPage, totalPages, totalItems, pageSize, onPageChangeName, onPageSizeChangeName, unitName = 'data') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (totalItems === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  // Generate opsi Halaman (1, 2, 3... totalPages)
  let pageOptionsHtml = '';
  for (let i = 1; i <= totalPages; i++) {
    pageOptionsHtml += `<option value="${i}" ${i === currentPage ? 'selected' : ''}>${i}</option>`;
  }

  // Generate opsi Baris (10, 25, 50, 100) persis referensi pengguna
  const sizes = [10, 25, 50, 100];
  let sizeOptionsHtml = '';
  sizes.forEach(sz => {
    sizeOptionsHtml += `<option value="${sz}" ${sz === pageSize ? 'selected' : ''}>${sz}</option>`;
  });

  const prevDisabled = currentPage <= 1 ? 'disabled' : '';
  const nextDisabled = currentPage >= totalPages ? 'disabled' : '';

  container.innerHTML = `
    <div class="pagination-info">
      Menampilkan <strong>${start}–${end}</strong> dari <strong>${totalItems}</strong> ${unitName}
    </div>
    <div class="pagination-nav-group">
      <div class="pagination-dropdown-field">
        <span class="pagination-field-label">Halaman</span>
        <div class="pagination-select-wrap">
          <select class="pagination-field-select" onchange="${onPageChangeName}(Number(this.value))" aria-label="Pilih Halaman">
            ${pageOptionsHtml}
          </select>
          <svg class="pagination-select-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>

      <div class="pagination-dropdown-field">
        <span class="pagination-field-label">Baris</span>
        <div class="pagination-select-wrap">
          <select class="pagination-field-select" onchange="${onPageSizeChangeName}(Number(this.value))" aria-label="Pilih Jumlah Baris">
            ${sizeOptionsHtml}
          </select>
          <svg class="pagination-select-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>

      <div class="pagination-nav-arrows">
        <button type="button" class="page-nav-arrow" ${prevDisabled} onclick="${onPageChangeName}(${currentPage - 1})" title="Halaman Sebelumnya" aria-label="Halaman Sebelumnya">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <button type="button" class="page-nav-arrow" ${nextDisabled} onclick="${onPageChangeName}(${currentPage + 1})" title="Halaman Berikutnya" aria-label="Halaman Berikutnya">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>
    </div>
  `;
}

// ====== FUNGSI VERIFIKASI LANGSUNG DARI WEB (DENGAN SWEETALERT2) ======
async function verifikasiKehadiran(no, kodeMatkul, pertemuan, statusBaru, catatan = '') {
  if (!isAdminLoggedIn || !savedAdminPin) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'warning',
        title: 'Akses Ditolak',
        text: 'Silakan Masuk sebagai Admin terlebih dahulu untuk memverifikasi absensi.',
        confirmButtonColor: '#0a62e8',
        confirmButtonText: 'Masuk Admin'
      }).then((res) => {
        if (res.isConfirmed) bukaModalAdminAuth();
      });
    } else {
      alert('Akses ditolak: Silakan Masuk sebagai Admin terlebih dahulu.');
      bukaModalAdminAuth();
    }
    return;
  }

  const isBatal = statusBaru !== 'Terverifikasi';
  const actionTitle = statusBaru === 'Terverifikasi' ? 'Konfirmasi Verifikasi' : (statusBaru === 'Ditolak' ? 'Konfirmasi Penolakan' : 'Batalkan Verifikasi?');
  const actionHtml = statusBaru === 'Terverifikasi'
    ? `Apakah Anda yakin ingin memverifikasi kehadiran perkuliahan ke-<b>${pertemuan}</b> (${kodeMatkul}) menjadi <span style="color:#0a62e8;font-weight:700;">"Terverifikasi"</span>?`
    : `Apakah Anda yakin ingin mengubah status pertemuan ke-<b>${pertemuan}</b> (${kodeMatkul}) menjadi <span style="color:#f59e0b;font-weight:700;">"${statusBaru}"</span>?`;
  const confirmBtnText = statusBaru === 'Terverifikasi' ? 'Ya, Verifikasi Kehadiran' : `Ya, Ubah ke ${statusBaru}`;
  const confirmBtnColor = statusBaru === 'Terverifikasi' ? '#0a62e8' : (statusBaru === 'Ditolak' ? '#e11d48' : '#f59e0b');

  let konfirm = false;
  if (typeof Swal !== 'undefined') {
    const swalRes = await Swal.fire({
      title: actionTitle,
      html: actionHtml,
      icon: statusBaru === 'Terverifikasi' ? 'question' : 'warning',
      showCancelButton: true,
      confirmButtonColor: confirmBtnColor,
      cancelButtonColor: '#64748b',
      confirmButtonText: confirmBtnText,
      cancelButtonText: 'Batal',
      reverseButtons: true,
      focusCancel: true
    });
    konfirm = swalRes.isConfirmed;
  } else {
    konfirm = confirm(`Apakah Anda yakin ingin mengubah status verifikasi ini menjadi "${statusBaru}"?`);
  }

  if (!konfirm) return;

  // Cari item di state lokal
  const item = semuaData.find(d => 
    (no && Number(d.no) === Number(no)) ||
    (d.kodeMatkul === kodeMatkul && Number(d.pertemuan) === Number(pertemuan))
  );

  const statusLama = item ? item.statusVerifikasi : '';
  const catatanLama = item ? (item.catatanPenolakan || item.catatan || '') : '';
  if (item) {
    item.statusVerifikasi = 'Memproses...';
    render();
  }

  try {
    const payload = {
      action: 'verifikasi',
      secret: SECRET_KEY,
      pin: savedAdminPin, // PIN Admin dikirim ke server untuk validasi ganda
      no: no,
      kodeMatkul: kodeMatkul,
      pertemuan: pertemuan,
      status: statusBaru,
      statusVerifikasi: statusBaru,
      catatan: catatan,
      catatanPenolakan: catatan
    };

    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || 'Gagal mengubah status');

    if (item) {
      item.statusVerifikasi = statusBaru;
      item.catatanPenolakan = catatan;
      item.catatan = catatan;
    }
    render();

    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'success',
        title: 'Berhasil Diperbarui',
        html: `Status kehadiran berhasil diubah menjadi <b>"${statusBaru}"</b>.`,
        timer: 1800,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
    }
  } catch(err) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'error',
        title: 'Gagal Memproses',
        text: err.message || 'Gagal memproses verifikasi. Silakan coba lagi.',
        confirmButtonColor: '#0a62e8'
      });
    } else {
      alert('Gagal memproses verifikasi. Silakan coba lagi.');
    }
    if (item) {
      item.statusVerifikasi = statusLama;
      item.catatanPenolakan = catatanLama;
      item.catatan = catatanLama;
      render();
    }
  }
}

// ====== TOLAK KEHADIRAN DENGAN CATATAN ADMIN ======
async function tolakKehadiranDenganCatatan(no, kodeMatkul, pertemuan) {
  if (!isAdminLoggedIn || !savedAdminPin) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'warning',
        title: 'Akses Ditolak',
        text: 'Silakan Masuk sebagai Admin terlebih dahulu untuk menolak absensi.',
        confirmButtonColor: '#0a62e8',
        confirmButtonText: 'Masuk Admin'
      }).then((res) => {
        if (res.isConfirmed) bukaModalAdminAuth();
      });
    } else {
      alert('Akses ditolak: Silakan Masuk sebagai Admin terlebih dahulu.');
      bukaModalAdminAuth();
    }
    return;
  }

  const item = semuaData.find(d => 
    (no && Number(d.no) === Number(no)) ||
    (d.kodeMatkul === kodeMatkul && Number(d.pertemuan) === Number(pertemuan))
  );

  const catatanEksis = item ? (item.catatanPenolakan || item.catatan || '') : '';

  if (typeof Swal !== 'undefined') {
    const { value: catatanInput, isConfirmed } = await Swal.fire({
      title: 'Tolak Absensi Perkuliahan',
      html: `Berikan catatan revisi untuk pertemuan ke-<b>${pertemuan}</b> (${kodeMatkul}) - <b>${esc(item ? item.dosen : '')}</b>:`,
      input: 'textarea',
      inputValue: catatanEksis,
      inputPlaceholder: 'Tuliskan alasan penolakan atau instruksi revisi untuk dosen (misal: Bukti foto kurang jelas / materi tidak sesuai)...',
      inputAttributes: {
        'aria-label': 'Catatan penolakan'
      },
      showCancelButton: true,
      confirmButtonText: '✕ Simpan Penolakan',
      confirmButtonColor: '#e11d48',
      cancelButtonText: 'Batal',
      cancelButtonColor: '#64748b',
      reverseButtons: true,
      inputValidator: (value) => {
        if (!value || !value.trim()) {
          return 'Catatan penolakan wajib diisi agar dosen mengetahui bagian yang perlu direvisi!';
        }
      }
    });

    if (!isConfirmed) return;
    const catatan = catatanInput.trim();

    const statusLama = item ? item.statusVerifikasi : '';
    if (item) {
      item.statusVerifikasi = 'Memproses...';
      render();
    }

    try {
      const payload = {
        action: 'verifikasi',
        secret: SECRET_KEY,
        pin: savedAdminPin,
        no: no,
        kodeMatkul: kodeMatkul,
        pertemuan: pertemuan,
        status: 'Ditolak',
        statusVerifikasi: 'Ditolak',
        catatan: catatan,
        catatanPenolakan: catatan
      };

      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.status !== 'ok') throw new Error(json.message || 'Gagal menolak absensi');

      if (item) {
        item.statusVerifikasi = 'Ditolak';
        item.catatanPenolakan = catatan;
        item.catatan = catatan;
      }
      render();

      Swal.fire({
        icon: 'success',
        title: 'Absensi Ditolak',
        html: `Status absensi telah diubah menjadi <b>"Ditolak"</b> dan catatan penolakan telah tersimpan.`,
        timer: 2000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
    } catch(err) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal Memproses',
        text: err.message || 'Gagal memproses penolakan. Silakan coba lagi.',
        confirmButtonColor: '#0a62e8'
      });
      if (item) {
        item.statusVerifikasi = statusLama;
        render();
      }
    }
  } else {
    const catatan = prompt('Tuliskan alasan penolakan untuk dosen:');
    if (!catatan || !catatan.trim()) return;
    verifikasiKehadiran(no, kodeMatkul, pertemuan, 'Ditolak', catatan.trim());
  }
}

// ====== DIALOG OPSI ADMIN UNTUK DATA YANG SUDAH TERVERIFIKASI / DITOLAK ======
async function bukaDialogAdminVerif(no, kodeMatkul, pertemuan) {
  if (!isAdminLoggedIn) return;

  const item = semuaData.find(d => 
    (no && Number(d.no) === Number(no)) ||
    (d.kodeMatkul === kodeMatkul && Number(d.pertemuan) === Number(pertemuan))
  );
  if (!item) return;

  const isVerif = (item.statusVerifikasi || '').toLowerCase().includes('terverifikasi');
  const isDitolak = (item.statusVerifikasi || '').toLowerCase().includes('ditolak');

  if (typeof Swal !== 'undefined') {
    if (isVerif) {
      const res = await Swal.fire({
        title: 'Kelola Status Verifikasi',
        html: `Pertemuan ke-<b>${pertemuan}</b> (${kodeMatkul}) saat ini berstatus <span style="color:#0a62e8;font-weight:700;">"Terverifikasi"</span>.<br>Pilih aksi selanjutnya:`,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Batalkan ke Menunggu',
        confirmButtonColor: '#f59e0b',
        denyButtonText: 'Tolak dengan Catatan',
        denyButtonColor: '#e11d48',
        cancelButtonText: 'Tutup',
        cancelButtonColor: '#64748b'
      });

      if (res.isConfirmed) {
        verifikasiKehadiran(no, kodeMatkul, pertemuan, 'Menunggu Verifikasi');
      } else if (res.isDenied) {
        tolakKehadiranDenganCatatan(no, kodeMatkul, pertemuan);
      }
    } else if (isDitolak) {
      const res = await Swal.fire({
        title: 'Kelola Status Ditolak',
        html: `Pertemuan ke-<b>${pertemuan}</b> (${kodeMatkul}) saat ini berstatus <span style="color:#e11d48;font-weight:700;">"Ditolak"</span>.<br>Pilih tindakan yang diinginkan:`,
        icon: 'warning',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '✓ Setujui (Terverifikasi)',
        confirmButtonColor: '#0a62e8',
        denyButtonText: 'Edit Catatan Penolakan',
        denyButtonColor: '#f59e0b',
        cancelButtonText: 'Tutup',
        cancelButtonColor: '#64748b'
      });

      if (res.isConfirmed) {
        verifikasiKehadiran(no, kodeMatkul, pertemuan, 'Terverifikasi');
      } else if (res.isDenied) {
        tolakKehadiranDenganCatatan(no, kodeMatkul, pertemuan);
      }
    }
  }
}

// ====== MODAL CATATAN PENOLAKAN ADMIN ======
function lihatCatatanPenolakan(dosen, matkul, pertemuan, catatan) {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: 'Catatan Penolakan Admin',
      html: `
        <div style="text-align:left; font-size:13px; color:var(--text-secondary); margin-bottom:12px;">
          <strong>${esc(dosen)}</strong> • ${esc(matkul)} (Pertemuan ${esc(pertemuan)})
        </div>
        <div style="text-align:left; background:rgba(225,29,72,0.06); border:1.5px solid rgba(225,29,72,0.3); border-radius:8px; padding:14px; font-size:13.5px; line-height:1.6; color:var(--text-primary);">
          <div style="font-weight:700; color:#e11d48; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            Alasan Penolakan:
          </div>
          <div>${esc(catatan)}</div>
        </div>
        <div style="margin-top:14px; font-size:12.5px; color:var(--text-muted); text-align:left;">
          Silakan klik tombol <b>Revisi / Edit</b> pada tabel untuk memperbaiki absensi Anda dan mengirimkannya kembali.
        </div>
      `,
      icon: 'warning',
      confirmButtonText: 'Tutup',
      confirmButtonColor: '#0a62e8'
    });
  } else {
    alert('Catatan Penolakan:\n\n' + catatan);
  }
}

// ====== MODAL EDIT ABSENSI (OPSI A) ======
const modalEditAbsensi = document.getElementById('modalEditAbsensi');
const btnCloseEditModal = document.getElementById('btnCloseEditModal');
const btnCancelEdit = document.getElementById('btnCancelEdit');
const formEditAbsensi = document.getElementById('formEditAbsensi');
const editAdaTransport = document.getElementById('editAdaTransport');
const wrapEditNominalTransport = document.getElementById('wrapEditNominalTransport');
const wrapEditFileTransport = document.getElementById('wrapEditFileTransport');

// Elements File Bukti Baru
const editFileBukti = document.getElementById('editFileBukti');
const dropzoneEditBukti = document.getElementById('dropzoneEditBukti');
const editBuktiEmpty = document.getElementById('editBuktiEmpty');
const editBuktiSelected = document.getElementById('editBuktiSelected');
const editFileBuktiThumb = document.getElementById('editFileBuktiThumb');
const editBuktiFileName = document.getElementById('editBuktiFileName');
const editBuktiFileSize = document.getElementById('editBuktiFileSize');
const btnHapusEditBukti = document.getElementById('btnHapusEditBukti');

// Elements File Struk Baru
const editFileTransport = document.getElementById('editFileTransport');
const dropzoneEditTransport = document.getElementById('dropzoneEditTransport');
const editTransportEmpty = document.getElementById('editTransportEmpty');
const editTransportSelected = document.getElementById('editTransportSelected');
const editTransportFileName = document.getElementById('editTransportFileName');
const editTransportFileSize = document.getElementById('editTransportFileSize');
const editTransportThumbWrap = document.getElementById('editTransportThumbWrap');
const btnHapusEditTransport = document.getElementById('btnHapusEditTransport');

let activeEditPin = '';

function formatUkuranFile(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function resetEditBuktiFile() {
  if (editFileBukti) editFileBukti.value = '';
  if (editBuktiEmpty) editBuktiEmpty.style.display = 'flex';
  if (editBuktiSelected) editBuktiSelected.style.display = 'none';
  if (dropzoneEditBukti) dropzoneEditBukti.classList.remove('has-file', 'drag-over');
  if (editFileBuktiThumb) editFileBuktiThumb.removeAttribute('src');
}

function resetEditTransportFile() {
  if (editFileTransport) editFileTransport.value = '';
  if (editTransportEmpty) editTransportEmpty.style.display = 'flex';
  if (editTransportSelected) editTransportSelected.style.display = 'none';
  if (dropzoneEditTransport) dropzoneEditTransport.classList.remove('has-file', 'drag-over');
}

function tutupModalEditAbsensi() {
  if (modalEditAbsensi) {
    modalEditAbsensi.classList.remove('active');
  }
  resetEditBuktiFile();
  resetEditTransportFile();
}

if (btnCloseEditModal) btnCloseEditModal.addEventListener('click', tutupModalEditAbsensi);
if (btnCancelEdit) btnCancelEdit.addEventListener('click', tutupModalEditAbsensi);
if (modalEditAbsensi) {
  modalEditAbsensi.addEventListener('click', (e) => {
    if (e.target === modalEditAbsensi) tutupModalEditAbsensi();
  });
}

function updateEditTransportVisibility() {
  const ada = editAdaTransport && editAdaTransport.value === 'ya';
  if (wrapEditNominalTransport) wrapEditNominalTransport.style.display = ada ? 'block' : 'none';
  if (wrapEditFileTransport) wrapEditFileTransport.style.display = ada ? 'block' : 'none';
  if (!ada) {
    const inputNominal = document.getElementById('editNominalTransport');
    if (inputNominal) inputNominal.value = '';
    resetEditTransportFile();
  }
}

if (editAdaTransport) {
  editAdaTransport.addEventListener('change', updateEditTransportVisibility);
}

// Handler Upload Foto Bukti Baru
if (editFileBukti) {
  editFileBukti.addEventListener('change', () => {
    const file = editFileBukti.files && editFileBukti.files[0];
    if (file) {
      if (editBuktiFileName) editBuktiFileName.textContent = file.name;
      if (editBuktiFileSize) editBuktiFileSize.textContent = formatUkuranFile(file.size);
      if (editBuktiEmpty) editBuktiEmpty.style.display = 'none';
      if (editBuktiSelected) editBuktiSelected.style.display = 'flex';
      if (dropzoneEditBukti) dropzoneEditBukti.classList.add('has-file');

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (editFileBuktiThumb) editFileBuktiThumb.src = e.target.result;
        };
        reader.readAsDataURL(file);
      }
    } else {
      resetEditBuktiFile();
    }
  });
}

if (btnHapusEditBukti) {
  btnHapusEditBukti.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    resetEditBuktiFile();
  });
}

if (dropzoneEditBukti) {
  ['dragenter', 'dragover'].forEach(ev => {
    dropzoneEditBukti.addEventListener(ev, (e) => {
      e.preventDefault();
      if (!dropzoneEditBukti.classList.contains('has-file')) {
        dropzoneEditBukti.classList.add('drag-over');
      }
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropzoneEditBukti.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzoneEditBukti.classList.remove('drag-over');
    });
  });
  dropzoneEditBukti.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        editFileBukti.files = e.dataTransfer.files;
        editFileBukti.dispatchEvent(new Event('change'));
      }
    }
  });
}

// Handler Upload Struk Transportasi Baru
if (editFileTransport) {
  editFileTransport.addEventListener('change', () => {
    const file = editFileTransport.files && editFileTransport.files[0];
    if (file) {
      if (editTransportFileName) editTransportFileName.textContent = file.name;
      if (editTransportFileSize) editTransportFileSize.textContent = formatUkuranFile(file.size);
      if (editTransportEmpty) editTransportEmpty.style.display = 'none';
      if (editTransportSelected) editTransportSelected.style.display = 'flex';
      if (dropzoneEditTransport) dropzoneEditTransport.classList.add('has-file');

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (editTransportThumbWrap) {
            editTransportThumbWrap.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover;" alt="Preview struk">`;
          }
        };
        reader.readAsDataURL(file);
      } else {
        if (editTransportThumbWrap) {
          editTransportThumbWrap.innerHTML = `
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>`;
        }
      }
    } else {
      resetEditTransportFile();
    }
  });
}

if (btnHapusEditTransport) {
  btnHapusEditTransport.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    resetEditTransportFile();
  });
}

if (dropzoneEditTransport) {
  ['dragenter', 'dragover'].forEach(ev => {
    dropzoneEditTransport.addEventListener(ev, (e) => {
      e.preventDefault();
      if (!dropzoneEditTransport.classList.contains('has-file')) {
        dropzoneEditTransport.classList.add('drag-over');
      }
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropzoneEditTransport.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzoneEditTransport.classList.remove('drag-over');
    });
  });
  dropzoneEditTransport.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      editFileTransport.files = e.dataTransfer.files;
      editFileTransport.dispatchEvent(new Event('change'));
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

// Buka Modal Edit Absensi (Validasi PIN Dosen / Admin)
async function mulaiEditAbsensi(no, kodeMatkul, pertemuan) {
  const item = semuaData.find(d => 
    (no && Number(d.no) === Number(no)) ||
    (d.kodeMatkul === kodeMatkul && Number(d.pertemuan) === Number(pertemuan))
  );

  if (!item) {
    alert('Data absensi tidak ditemukan.');
    return;
  }

  const isVerif = (item.statusVerifikasi || '').toLowerCase().includes('terverifikasi');
  if (isVerif) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'info',
        title: 'Absensi Terkunci',
        text: 'Data absensi yang telah Terverifikasi oleh Admin tidak dapat diedit kembali.',
        confirmButtonColor: '#0a62e8'
      });
    } else {
      alert('Data absensi yang telah Terverifikasi oleh Admin tidak dapat diedit kembali.');
    }
    return;
  }

  // Jika bukan Admin yang login, minta PIN Dosen
  if (!isAdminLoggedIn) {
    const sessionKey = 'dosen_auth_pin_' + item.dosen;
    let authPin = sessionStorage.getItem(sessionKey);

    if (masterFetchPromise) {
      await masterFetchPromise;
    } else {
      await ambilMasterPasswords();
    }

    if (!authPin) {
      if (typeof Swal !== 'undefined') {
        const { value: inputPin, isConfirmed } = await Swal.fire({
          title: 'Verifikasi Dosen Pengampu',
          html: `Masukkan PIN untuk mengedit absensi:<br><strong>${esc(item.dosen)}</strong>`,
          input: 'password',
          inputPlaceholder: 'Masukkan PIN Dosen',
          showCancelButton: true,
          confirmButtonText: 'Lanjutkan Edit',
          confirmButtonColor: '#0a62e8',
          cancelButtonText: 'Batal',
          cancelButtonColor: '#64748b',
          inputValidator: (val) => {
            if (!val || !val.trim()) return 'PIN wajib diisi!';
            const pinTrim = val.trim();
            const passBenar = cariPinDosen(item.dosen);
            const cocokDosen = passBenar && (pinTrim === passBenar || pinTrim.toLowerCase() === passBenar.toLowerCase());
            const cocokAdmin = daftarAdminPasswords.some(p => p === pinTrim || p.toLowerCase() === pinTrim.toLowerCase());

            if (!cocokDosen && !cocokAdmin) {
              return passBenar ? 'PIN tidak cocok untuk dosen ini!' : 'PIN salah atau dosen belum memiliki PIN di sheet!';
            }
          }
        });

        if (!isConfirmed) return;
        authPin = inputPin.trim();
        sessionStorage.setItem(sessionKey, authPin);
      } else {
        const inputPin = prompt(`Masukkan PIN untuk ${item.dosen}:`);
        if (!inputPin) return;
        authPin = inputPin.trim();
      }
    }
    activeEditPin = authPin;
  } else {
    activeEditPin = savedAdminPin;
  }

  // Isi data ke Form Edit Modal
  document.getElementById('editItemNo').value = item.no || '';
  document.getElementById('editItemKodeMatkul').value = item.kodeMatkul || '';
  document.getElementById('editItemPertemuan').value = item.pertemuan || '';

  document.getElementById('editDosenNama').textContent = item.dosen || '-';
  document.getElementById('editMatkulNama').textContent = (item.mataKuliah || item.kodeMatkul || '-') + (item.kodeMatkul ? ` (${item.kodeMatkul})` : '');
  document.getElementById('editPertemuanKe').textContent = `Pertemuan ${item.pertemuan || '-'}`;
  document.getElementById('editSemesterVal').textContent = `Semester ${item.semester || '-'}`;

  // Tanggal
  let tglFormatted = '';
  if (item.tanggal) {
    if (typeof item.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.tanggal.trim())) {
      tglFormatted = item.tanggal.trim();
    } else {
      const dt = new Date(item.tanggal);
      if (!isNaN(dt.getTime())) {
        tglFormatted = dt.toISOString().slice(0, 10);
      }
    }
  }
  document.getElementById('editTanggal').value = tglFormatted || new Date().toISOString().slice(0, 10);

  // Status Kehadiran
  document.getElementById('editStatusKehadiran').value = item.statusKehadiran || 'Hadir';

  // Metode
  document.getElementById('editMetode').value = item.metode || 'Offline';

  // Lokasi
  document.getElementById('editLokasi').value = item.lokasi || '';

  // Materi
  document.getElementById('editMateri').value = item.linkMateri || item.materi || '';

  // Banner Catatan Penolakan jika status Ditolak
  const alertRejection = document.getElementById('editAlertRejection');
  const alertNoteText = document.getElementById('editRejectionNoteText');
  const catatan = (item.catatanPenolakan || item.catatan || item.catatanAdmin || '').trim();
  const isDitolak = (item.statusVerifikasi || '').toLowerCase().includes('ditolak');

  if (isDitolak && catatan) {
    if (alertNoteText) alertNoteText.textContent = catatan;
    if (alertRejection) alertRejection.style.display = 'flex';
  } else {
    if (alertRejection) alertRejection.style.display = 'none';
  }

  // Foto Bukti
  const linkBukti = (item.buktiKelas || item.bukti || item.linkBukti || '').trim();
  const wrapBukti = document.getElementById('editCurrentBuktiWrap');
  const linkBuktiEl = document.getElementById('editCurrentBuktiLink');
  if (linkBukti && linkBukti !== '-') {
    wrapBukti.style.display = 'inline-flex';
    linkBuktiEl.href = linkBukti;
  } else {
    wrapBukti.style.display = 'none';
  }
  resetEditBuktiFile();

  // Struk Transportasi
  const nominal = item.nominalTransport || item.biayaTransport || 0;
  const linkStruk = (item.linkStrukTransport || item.linkStruk || item.struk || '').trim();
  const adaTransport = Number(nominal) > 0 || (linkStruk && linkStruk !== '-');
  if (editAdaTransport) editAdaTransport.value = adaTransport ? 'ya' : 'tidak';
  updateEditTransportVisibility();
  document.getElementById('editNominalTransport').value = Number(nominal) > 0 ? Number(nominal) : '';

  const wrapStruk = document.getElementById('editCurrentStrukWrap');
  const linkStrukEl = document.getElementById('editCurrentStrukLink');
  if (linkStruk && linkStruk !== '-') {
    wrapStruk.style.display = 'inline-flex';
    linkStrukEl.href = linkStruk;
  } else {
    wrapStruk.style.display = 'none';
  }
  resetEditTransportFile();

  // Buka modal
  modalEditAbsensi.classList.add('active');
}

// Submit Simpan Perubahan Edit
if (formEditAbsensi) {
  formEditAbsensi.addEventListener('submit', async (e) => {
    e.preventDefault();

    const no = document.getElementById('editItemNo').value;
    const kodeMatkul = document.getElementById('editItemKodeMatkul').value;
    const pertemuan = document.getElementById('editItemPertemuan').value;

    const item = semuaData.find(d => 
      (no && Number(d.no) === Number(no)) ||
      (d.kodeMatkul === kodeMatkul && Number(d.pertemuan) === Number(pertemuan))
    );

    const tgl = document.getElementById('editTanggal').value;
    const statusKehadiran = document.getElementById('editStatusKehadiran').value;
    const metode = document.getElementById('editMetode').value;
    const lokasi = document.getElementById('editLokasi').value.trim();
    const materi = document.getElementById('editMateri').value.trim();

    const adaTransport = editAdaTransport && editAdaTransport.value === 'ya';
    const nominalTransport = adaTransport ? (document.getElementById('editNominalTransport').value || '0') : '0';

    const btnSubmit = document.getElementById('btnSubmitEdit');
    const btnText = document.getElementById('btnSubmitEditText');
    const spinner = document.getElementById('editSpinner');

    if (btnSubmit) btnSubmit.disabled = true;
    if (btnText) btnText.textContent = 'Menyimpan...';
    if (spinner) spinner.style.display = 'inline-block';

    try {
      let fileBuktiBase64 = '';
      let namaFileBukti = '';
      let mimeFileBukti = '';

      if (editFileBukti && editFileBukti.files.length > 0) {
        const fileB = editFileBukti.files[0];
        fileBuktiBase64 = await fileToBase64(fileB);
        namaFileBukti = fileB.name;
        mimeFileBukti = fileB.type || 'image/jpeg';
      }

      let fileStrukBase64 = '';
      let namaFileStruk = '';
      let mimeFileStruk = '';

      if (adaTransport && editFileTransport && editFileTransport.files.length > 0) {
        const fileS = editFileTransport.files[0];
        fileStrukBase64 = await fileToBase64(fileS);
        namaFileStruk = fileS.name;
        mimeFileStruk = fileS.type || 'image/jpeg';
      }

      const payload = {
        action: 'edit',
        secret: SECRET_KEY,
        pin: activeEditPin || savedAdminPin || '',
        no: no,
        kodeMatkul: kodeMatkul,
        pertemuan: pertemuan,
        tanggal: tgl,
        statusKehadiran: statusKehadiran,
        status: statusKehadiran,
        metode: metode,
        lokasi: lokasi,
        linkMateri: materi,
        materi: materi,
        adaStrukTransport: adaTransport ? 'Ya' : 'Tidak',
        nominalTransport: nominalTransport,
        biayaTransport: nominalTransport,
        // File Bukti (diisi jika ada file baru)
        fileBase64: fileBuktiBase64,
        namaFile: namaFileBukti,
        mimeFile: mimeFileBukti,
        // File Struk (diisi jika ada file baru)
        fileTransportBase64: fileStrukBase64,
        namaFileTransport: namaFileStruk,
        mimeFileTransport: mimeFileStruk
      };

      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();

      if (json.status !== 'ok') {
        throw new Error(json.message || 'Gagal menyimpan perubahan absensi.');
      }

      // Update state lokal
      if (item) {
        item.tanggal = tgl;
        item.statusKehadiran = statusKehadiran;
        item.metode = metode;
        item.lokasi = lokasi;
        item.linkMateri = materi;
        item.materi = materi;
        item.statusVerifikasi = 'Menunggu Verifikasi';
        item.catatanPenolakan = '';
        item.catatan = '';
        item.nominalTransport = nominalTransport;
        item.biayaTransport = nominalTransport;
        if (json.linkBukti) item.buktiKelas = json.linkBukti;
        if (json.linkStruk) item.linkStrukTransport = json.linkStruk;
      }

      tutupModalEditAbsensi();
      render();

      if (typeof Swal !== 'undefined') {
        Swal.fire({
          icon: 'success',
          title: 'Berhasil Diperbarui',
          html: 'Data absensi berhasil diperbaiki.<br><span style="font-size:13px;color:var(--text-secondary);">Status absensi dikembalikan ke <b>"Menunggu Verifikasi"</b> untuk ditinjau ulang oleh Admin.</span>',
          confirmButtonColor: '#0a62e8'
        });
      } else {
        alert('Data absensi berhasil diperbaiki dan status dikembalikan ke Menunggu Verifikasi.');
      }
    } catch (err) {
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          icon: 'error',
          title: 'Gagal Menyimpan',
          text: err.message || 'Terjadi kesalahan saat menyimpan perubahan. Silakan coba lagi.',
          confirmButtonColor: '#0a62e8'
        });
      } else {
        alert('Gagal menyimpan perubahan: ' + err.message);
      }
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
      if (btnText) btnText.textContent = 'Simpan Perubahan';
      if (spinner) spinner.style.display = 'none';
    }
  });
}

// Global scope bindings for HTML event attributes
window.tampilkanBukti = tampilkanBukti;
window.verifikasiKehadiran = verifikasiKehadiran;
window.tolakKehadiranDenganCatatan = tolakKehadiranDenganCatatan;
window.bukaDialogAdminVerif = bukaDialogAdminVerif;
window.lihatCatatanPenolakan = lihatCatatanPenolakan;
window.mulaiEditAbsensi = mulaiEditAbsensi;
window.tutupModalEditAbsensi = tutupModalEditAbsensi;
window.tutupModalBukti = tutupModalBukti;
window.bukaModalAdminAuth = bukaModalAdminAuth;
window.tutupModalAdminAuth = tutupModalAdminAuth;
window.gantiHalamanDashboard = function(page) {
  dashboardCurrentPage = page;
  render();
};
window.gantiBarisDashboard = function(newSize) {
  dashboardPageSize = Number(newSize) || 10;
  dashboardCurrentPage = 1;
  render();
};

async function muatData() {
  checkAdminSession();
  try {
    const res = await fetch(SCRIPT_URL + '?action=data');
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message);

    semuaData = json.data;
    isiFilters();
    const pesanEl = document.getElementById('pesan');
    const kontenEl = document.getElementById('konten');
    if (pesanEl) pesanEl.style.display = 'none';
    if (kontenEl) kontenEl.style.display = 'block';
    render();
  } catch (err) {
    const pesanEl = document.getElementById('pesan');
    if (pesanEl) {
      pesanEl.innerHTML =
        '<div style="color:var(--error);font-weight:600;margin-bottom:6px;">Gagal memuat data.</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);">Silakan periksa koneksi internet Anda lalu coba lagi.</div>';
    }
  }
}

muatData();
