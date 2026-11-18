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

// State Admin & PIN (Kolom J Sheet Matkul)
let isAdminLoggedIn = false;
let savedAdminPin = '';
let daftarPasswordSah = ['adminidn2026', 'absensidosenpidnb2026'];
let masterFetchPromise = null;

// Fallback map SKS berdasarkan sheet Matkul (tanpa ubah sheet Absensi)
const FALLBACK_SKS = {
  'RPL-250101': 3, 'RPL-250102': 3, 'RPL-250103': 3, 'RPL-250104': 3, 'RPL-250105': 4, 'RPL-250106': 4,
  'RMG-250101': 3, 'RMG-250102': 3, 'RMG-250103': 3, 'RMG-250104': 4, 'RMG-250105': 4, 'RMG-250106': 3,
  'RKJ-250101': 3, 'RKJ-250102': 3, 'RKJ-250103': 3, 'RKJ-250104': 4, 'RKJ-250105': 4, 'RKJ-250106': 3
};
let mapSks = { ...FALLBACK_SKS };

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
      const sandiServer = [];
      if (mJson.passwords && Array.isArray(mJson.passwords)) {
        sandiServer.push(...mJson.passwords);
      }
      if (mJson.password) {
        sandiServer.push(mJson.password);
      }
      if (mJson.dosenPasswords && typeof mJson.dosenPasswords === 'object') {
        sandiServer.push(...Object.values(mJson.dosenPasswords));
      }
      if (sandiServer.length > 0) {
        daftarPasswordSah = [...new Set([...sandiServer, ...daftarPasswordSah])];
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

    const cocok = daftarPasswordSah.some(p => {
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

  // Tabel 20 data terbaru
  const elTabelBody = document.getElementById('tabelBody');
  if (elTabelBody) {
    const terbaru = [...data].sort((a, b) => parseTimestamp(b.tanggal) - parseTimestamp(a.tanggal)).slice(0, 20);
    elTabelBody.innerHTML = terbaru.map(d => {
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
      const isVerif = (d.statusVerifikasi || '').toLowerCase().includes('terverifikasi');
      const isProses = d.statusVerifikasi === 'Memproses...';

      let verifBtnHtml = '';
      if (!isAdminLoggedIn) {
        // Mode Publik / Dosen: Read-only badge (Dosen TIDAK BISA klik/verifikasi sendiri)
        if (isVerif) {
          verifBtnHtml = `<span class="badge ok" title="Sudah diverifikasi oleh Admin">✓ Terverifikasi</span>`;
        } else {
          verifBtnHtml = `<span class="badge warn" title="Menunggu verifikasi oleh Admin">Menunggu Verifikasi</span>`;
        }
      } else {
        // Mode Admin: Tombol interaktif untuk memverifikasi atau membatalkan status
        if (isProses) {
          verifBtnHtml = `<span class="badge warn">Memproses...</span>`;
        } else if (isVerif) {
          verifBtnHtml = `<button type="button" class="badge-verif-btn ok" title="Sudah Terverifikasi. Klik untuk membatalkan / ubah status" onclick="verifikasiKehadiran(${d.no}, '${esc(d.kodeMatkul)}', ${d.pertemuan}, 'Menunggu Verifikasi')">✓ Terverifikasi</button>`;
        } else {
          verifBtnHtml = `<button type="button" class="btn-verif-action" title="Klik untuk langsung memverifikasi kehadiran ini" onclick="verifikasiKehadiran(${d.no}, '${esc(d.kodeMatkul)}', ${d.pertemuan}, 'Terverifikasi')">✓ Verifikasi</button>`;
        }
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
        <td>${verifBtnHtml}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="12" class="pesan" style="border:none;box-shadow:none;">Belum ada data absensi</td></tr>';
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

// ====== FUNGSI VERIFIKASI LANGSUNG DARI WEB ======
async function verifikasiKehadiran(no, kodeMatkul, pertemuan, statusBaru) {
  if (!isAdminLoggedIn || !savedAdminPin) {
    alert('Akses ditolak: Silakan Masuk sebagai Admin terlebih dahulu.');
    bukaModalAdminAuth();
    return;
  }

  const konfirm = confirm(`Apakah Anda yakin ingin mengubah status verifikasi ini menjadi "${statusBaru}"?`);
  if (!konfirm) return;

  // Cari item di state lokal
  const item = semuaData.find(d => 
    (no && Number(d.no) === Number(no)) ||
    (d.kodeMatkul === kodeMatkul && Number(d.pertemuan) === Number(pertemuan))
  );

  const statusLama = item ? item.statusVerifikasi : '';
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
      status: statusBaru
    };

    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || 'Gagal mengubah status');

    if (item) {
      item.statusVerifikasi = statusBaru;
    }
    render();
  } catch(err) {
    alert('Gagal memproses verifikasi. Silakan coba lagi.');
    if (item) {
      item.statusVerifikasi = statusLama;
      render();
    }
  }
}

// Global scope bindings for HTML event attributes
window.tampilkanBukti = tampilkanBukti;
window.verifikasiKehadiran = verifikasiKehadiran;
window.tutupModalBukti = tutupModalBukti;
window.bukaModalAdminAuth = bukaModalAdminAuth;
window.tutupModalAdminAuth = tutupModalAdminAuth;

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
