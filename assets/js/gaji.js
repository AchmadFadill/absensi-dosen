/**
 * gaji.js - Logika Rekap Pertemuan & Honor Dosen
 * Politeknik IDN Bogor
 */

// ====== KONFIGURASI SISTEM ======
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby8f0xPX9qMO8eJpaF6XTtzOz8XjCOPJdrGB1LAdzeWGlSAFfN3QJvJl5C8c5Yksfcz/exec';
const TARIF_PER_SKS = 50000; // Rp 50.000 / SKS per kehadiran

// Fallback map SKS berdasarkan sheet Matkul jika master belum reload
const FALLBACK_SKS = {
  'RPL-250101': 3, 'RPL-250102': 3, 'RPL-250103': 3, 'RPL-250104': 3, 'RPL-250105': 4, 'RPL-250106': 4,
  'RMG-250101': 3, 'RMG-250102': 3, 'RMG-250103': 3, 'RMG-250104': 4, 'RMG-250105': 4, 'RMG-250106': 3,
  'RKJ-250101': 3, 'RKJ-250102': 3, 'RKJ-250103': 3, 'RKJ-250104': 4, 'RKJ-250105': 4, 'RKJ-250106': 3
};

// State Aplikasi
let masterData = { matkul: [], dosen: [], passwords: [] };
let rawAbsensi = [];
let mapSksMatkul = { ...FALLBACK_SKS };
let daftarPasswordSah = []; // Diisi dinamis murni dari Spreadsheet (Kolom J & Kolom M)

// Helper Sanitasi & Format
function esc(teks) {
  const div = document.createElement('div');
  div.textContent = teks ?? '';
  return div.innerHTML;
}

function rupiah(angka) {
  return 'Rp ' + Number(angka || 0).toLocaleString('id-ID');
}

function formatBulanTahun(tglStr) {
  if (!tglStr) return '';
  const d = new Date(tglStr);
  if (isNaN(d.getTime())) return '';
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return bulan[d.getMonth()] + ' ' + d.getFullYear();
}

function formatTanggalSingkat(raw) {
  if (!raw) return '-';
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const [y, m, d] = raw.trim().split('-');
    const bln = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return parseInt(d, 10) + ' ' + bln[parseInt(m, 10) - 1] + ' ' + y;
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) return esc(raw);
  const bln = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return d.getDate() + ' ' + bln[d.getMonth()] + ' ' + d.getFullYear();
}

function formatTanggalLengkap(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return '-';
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

// ====== SINKRONISASI MASTER DATA LANGSUNG SAAT HALAMAN DIBUKA ======
let masterFetchPromise = null;

async function ambilMasterData() {
  try {
    const res = await fetch(SCRIPT_URL + '?action=master');
    const json = await res.json();
    if (json && json.status === 'ok') {
      masterData = json;

      // Ambil daftar password dari Kolom J (Admin) dan Kolom M (PIN Dosen) murni dari Spreadsheet
      const sandiServer = [];
      if (json.passwords && Array.isArray(json.passwords)) {
        sandiServer.push(...json.passwords);
      }
      if (json.password) {
        sandiServer.push(json.password);
      }
      if (json.dosenPasswords && typeof json.dosenPasswords === 'object') {
        sandiServer.push(...Object.values(json.dosenPasswords));
      }

      daftarPasswordSah = [...new Set(sandiServer.map(p => String(p).trim()).filter(Boolean))];

      // Petakan SKS per Kode Matkul & Nama Matkul
      if (json.matkul && Array.isArray(json.matkul)) {
        json.matkul.forEach(m => {
          const sksVal = parseInt(m.sks, 10);
          if (sksVal > 0) {
            if (m.kode) mapSksMatkul[m.kode] = sksVal;
            if (m.nama) mapSksMatkul[m.nama] = sksVal;
          }
        });
      }
      return true;
    }
  } catch(err) {
    console.warn('Gagal sinkron master data dari Apps Script:', err);
  }
  return false;
}

// Panggil SECEPAT MUNGKIN saat halaman pertama kali dimuat
masterFetchPromise = ambilMasterData();

// ====== AUTENTIKASI KATA SANDI (KOLOM J) ======
const lockScreen = document.getElementById('lockScreen');
const portalContent = document.getElementById('portalContent');
const formAuth = document.getElementById('formAuth');
const inputPass = document.getElementById('inputPass');
const togglePass = document.getElementById('togglePass');
const lockAlert = document.getElementById('lockAlert');
const btnLogout = document.getElementById('btnLogout');
const btnUnlock = document.getElementById('btnUnlock');

// Toggle Visibility Password
if (togglePass && inputPass) {
  togglePass.addEventListener('click', () => {
    const type = inputPass.getAttribute('type') === 'password' ? 'text' : 'password';
    inputPass.setAttribute('type', type);
    const eyeIcon = document.getElementById('eyeIcon');
    if (eyeIcon) {
      eyeIcon.innerHTML = type === 'password' ?
        '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>' :
        '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
    }
  });
}

function cekSesiLogin() {
  try {
    const auth = sessionStorage.getItem('portal_honor_auth');
    if (auth === 'true') {
      bukaPortal();
    }
  } catch(e) {}
}

function bukaPortal() {
  if (lockScreen) lockScreen.style.display = 'none';
  if (portalContent) portalContent.style.display = 'block';
  if (btnLogout) btnLogout.style.display = 'inline-flex';
  muatDataPortal();
}

function kunciPortal() {
  try {
    sessionStorage.removeItem('portal_honor_auth');
  } catch(e) {}
  if (portalContent) portalContent.style.display = 'none';
  if (lockScreen) lockScreen.style.display = 'flex';
  if (btnLogout) btnLogout.style.display = 'none';
  if (inputPass) inputPass.value = '';
  if (lockAlert) {
    lockAlert.className = 'lock-alert';
    lockAlert.textContent = '';
  }
}

if (btnLogout) {
  btnLogout.addEventListener('click', kunciPortal);
}

if (formAuth && inputPass) {
  formAuth.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = inputPass.value.trim();
    if (!pass) return;

    const originalBtnText = btnUnlock ? btnUnlock.innerHTML : '';
    if (btnUnlock) {
      btnUnlock.disabled = true;
      btnUnlock.innerHTML = '<span>Memverifikasi PIN...</span>';
    }
    if (lockAlert) {
      lockAlert.className = 'lock-alert';
      lockAlert.textContent = '';
    }

    // Pastikan master data dari spreadsheet sudah selesai di-fetch
    if (masterFetchPromise) {
      await masterFetchPromise;
    } else {
      await ambilMasterData();
    }

    // Cocokkan kata sandi secara eksak maupun case-insensitive
    const cocok = daftarPasswordSah.some(p => {
      const strP = String(p).trim();
      return strP === pass || strP.toLowerCase() === pass.toLowerCase();
    });

    if (btnUnlock) {
      btnUnlock.disabled = false;
      btnUnlock.innerHTML = originalBtnText;
    }

    if (cocok) {
      try {
        sessionStorage.setItem('portal_honor_auth', 'true');
      } catch(e) {}
      bukaPortal();
    } else {
      if (lockAlert) {
        lockAlert.className = 'lock-alert err';
        lockAlert.innerHTML = '<strong>PIN salah.</strong> Silakan coba lagi.';
      }
      inputPass.focus();
    }
  });
}

// ====== SINKRONISASI DATA KEHADIRAN SETELAH LOGIN ======
async function muatDataPortal() {
  const loadingPesan = document.getElementById('loadingPesan');
  const dataContent = document.getElementById('dataContent');
  if (loadingPesan) loadingPesan.style.display = 'block';
  if (dataContent) dataContent.style.display = 'none';

  try {
    const resData = await fetch(SCRIPT_URL + '?action=data');
    const jsonData = await resData.json();
    if (jsonData.status !== 'ok') throw new Error(jsonData.message || 'Gagal memuat absensi');

    rawAbsensi = jsonData.data || [];

    inisialisasiFilter();
    if (loadingPesan) loadingPesan.style.display = 'none';
    if (dataContent) dataContent.style.display = 'block';
    renderGaji();
  } catch(err) {
    if (loadingPesan) {
      loadingPesan.innerHTML = 
        '<div style="color:var(--error);font-weight:600;margin-bottom:6px;">Gagal memuat data.</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);">Silakan periksa koneksi internet Anda lalu coba lagi.</div>';
    }
  }
}

// Cari SKS suatu matkul
function getSks(matkulKode, matkulNama) {
  if (matkulKode && mapSksMatkul[matkulKode]) return mapSksMatkul[matkulKode];
  if (matkulNama && mapSksMatkul[matkulNama]) return mapSksMatkul[matkulNama];
  for (const k in mapSksMatkul) {
    if (matkulNama && matkulNama.toLowerCase().includes(k.toLowerCase())) {
      return mapSksMatkul[k];
    }
  }
  return 3;
}

// Inisialisasi Filter Periode & Dosen
const filterBulan = document.getElementById('filterBulan');
const filterDosen = document.getElementById('filterDosen');
const filterStatus = document.getElementById('filterStatus');

function inisialisasiFilter() {
  const bulanSet = new Set();
  rawAbsensi.forEach(d => {
    const bt = formatBulanTahun(d.tanggal);
    if (bt) bulanSet.add(bt);
  });

  if (filterBulan) {
    filterBulan.innerHTML = '<option value="">Semua Periode</option>' +
      [...bulanSet].map(b => `<option value="${b}">${b}</option>`).join('');

    const bulanIni = formatBulanTahun(new Date().toISOString());
    if (bulanSet.has(bulanIni)) {
      filterBulan.value = bulanIni;
    }
  }

  const dosenSet = new Set(rawAbsensi.map(d => (d.dosen || '').trim()).filter(Boolean));
  if (masterData.dosen) {
    masterData.dosen.forEach(d => dosenSet.add(d.trim()));
  }

  if (filterDosen) {
    filterDosen.innerHTML = '<option value="">Semua Dosen</option>' +
      [...dosenSet].sort().map(d => `<option value="${d}">${d}</option>`).join('');
  }
}

// State Pagination
let rekapCurrentPage = 1;
let rekapPageSize = 10;

let logCurrentPage = 1;
let logPageSize = 10;

let isPrintingAllRekap = false;

// Helper Render Dropdown Pagination Attenad
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

[filterBulan, filterDosen, filterStatus].forEach(el => {
  if (el) el.addEventListener('change', () => {
    rekapCurrentPage = 1;
    logCurrentPage = 1;
    renderGaji();
  });
});

// ====== KALKULASI & RENDER GAJI ======
let rekapDosenTerhitung = [];

function renderGaji() {
  const pBulan = filterBulan ? filterBulan.value : '';
  const pDosen = filterDosen ? filterDosen.value : '';
  const pStatus = filterStatus ? filterStatus.value : 'Hadir';

  const wrapBulan = filterBulan ? filterBulan.closest('.filter-dropdown-wrap') : null;
  const wrapDosen = filterDosen ? filterDosen.closest('.filter-dropdown-wrap') : null;
  const wrapStatus = filterStatus ? filterStatus.closest('.filter-dropdown-wrap') : null;
  if (wrapBulan) wrapBulan.classList.toggle('has-filter', Boolean(pBulan));
  if (wrapDosen) wrapDosen.classList.toggle('has-filter', Boolean(pDosen));
  if (wrapStatus) wrapStatus.classList.toggle('has-filter', pStatus !== 'Hadir');

  // Filter Sesi Kehadiran berdasarkan Periode, Dosen, dan Status Kehadiran
  const sesiTersaring = rawAbsensi.filter(d => {
    const cocokBulan = !pBulan || formatBulanTahun(d.tanggal) === pBulan;
    const cocokDosen = !pDosen || (d.dosen || '').trim() === pDosen;
    const cocokStatus = pStatus === 'Semua' ? true : (d.statusKehadiran || '').toLowerCase() === 'hadir';
    return cocokBulan && cocokDosen && cocokStatus;
  });

  // ATURAN SISTEM: HANYA absensi yang telah TERVERIFIKASI oleh Admin yang dihitung honor & gajinya
  const sesiTerverifikasi = sesiTersaring.filter(d => {
    const statusV = (d.statusVerifikasi || '').toLowerCase();
    return statusV.includes('terverifikasi');
  });

  // 1. Grouping per Dosen (HANYA DARI SESI TERVERIFIKASI)
  const perDosen = {};

  sesiTerverifikasi.forEach(sesi => {
    const dosen = (sesi.dosen || 'Tanpa Nama').trim();
    const kode = sesi.kodeMatkul || '-';
    const namaMk = sesi.mataKuliah || '-';
    const keyMk = kode !== '-' ? kode : namaMk;
    const sks = getSks(kode, namaMk);

    const semVal = (sesi.semester && sesi.semester !== '-') 
      ? String(sesi.semester).trim() 
      : (function() {
          if (masterData && masterData.matkul) {
            const found = masterData.matkul.find(m => 
              (m.kode && m.kode === kode) || 
              (m.nama && namaMk && m.nama.toLowerCase() === namaMk.toLowerCase())
            );
            if (found && found.semester) return String(found.semester).trim();
          }
          return '';
        })();

    const transportSesi = Number(sesi.nominalTransport || sesi.biayaTransport || 0) || 0;

    if (!perDosen[dosen]) {
      perDosen[dosen] = {
        dosen: dosen,
        semesterSet: new Set(),
        matkulMap: {},
        totalSesi: 0,
        totalSksAkumulasi: 0,
        honorPerkuliahan: 0,
        totalTransport: 0,
        totalHonor: 0
      };
    }

    if (semVal) {
      perDosen[dosen].semesterSet.add(semVal);
    }

    if (!perDosen[dosen].matkulMap[keyMk]) {
      perDosen[dosen].matkulMap[keyMk] = {
        kode: kode,
        nama: namaMk,
        sks: sks,
        semester: semVal,
        jumlahSesi: 0,
        totalSksMatkul: 0,
        honorMatkul: 0
      };
    }

    perDosen[dosen].matkulMap[keyMk].jumlahSesi += 1;
    perDosen[dosen].matkulMap[keyMk].totalSksMatkul += sks;
    perDosen[dosen].matkulMap[keyMk].honorMatkul += (sks * TARIF_PER_SKS);

    perDosen[dosen].totalSesi += 1;
    perDosen[dosen].totalSksAkumulasi += sks;
    perDosen[dosen].honorPerkuliahan += (sks * TARIF_PER_SKS);
    perDosen[dosen].totalTransport += transportSesi;
    perDosen[dosen].totalHonor = perDosen[dosen].honorPerkuliahan + perDosen[dosen].totalTransport;
  });

  rekapDosenTerhitung = Object.values(perDosen);
  rekapDosenTerhitung.sort((a, b) => a.dosen.localeCompare(b.dosen));

  // 2. Hitung KPI Keseluruhan (Berdasarkan Sesi Terverifikasi)
  const totalSemuaHonor = rekapDosenTerhitung.reduce((acc, d) => acc + d.totalHonor, 0);
  const totalSemuaSks = rekapDosenTerhitung.reduce((acc, d) => acc + d.totalSksAkumulasi, 0);
  const totalSemuaSesi = sesiTerverifikasi.length;

  const elTotalGaji = document.getElementById('kpiTotalGaji');
  const elTotalSks = document.getElementById('kpiTotalSks');
  const elTotalSesi = document.getElementById('kpiTotalSesi');

  if (elTotalGaji) elTotalGaji.textContent = rupiah(totalSemuaHonor);
  if (elTotalSks) elTotalSks.textContent = totalSemuaSks + ' SKS';
  if (elTotalSesi) elTotalSesi.textContent = totalSemuaSesi + ' Sesi';

  const elTfootTotalSesi = document.getElementById('tfootTotalSesi');
  const elTfootTotalSks = document.getElementById('tfootTotalSks');
  const elTfootTotalHonor = document.getElementById('tfootTotalHonor');
  if (elTfootTotalSesi) elTfootTotalSesi.textContent = totalSemuaSesi + ' Sesi';
  if (elTfootTotalSks) elTfootTotalSks.textContent = totalSemuaSks + ' SKS';
  if (elTfootTotalHonor) elTfootTotalHonor.textContent = rupiah(totalSemuaHonor);

  // 3. Render Tabel Rekapitulasi per Dosen (dengan Pagination)
  const tbodyDosen = document.getElementById('tabelRekapDosen');
  const elPaginationRekap = document.getElementById('paginationRekap');

  if (tbodyDosen) {
    const totalRekap = rekapDosenTerhitung.length;
    const rekapTotalPages = Math.ceil(totalRekap / rekapPageSize) || 1;

    let pageRekap = [];
    let startIdxRekap = 0;
    let endIdxRekap = 0;

    if (isPrintingAllRekap) {
      // Saat mencetak dokumen rekapitulasi, tampilkan SELURUH data dosen tanpa terpotong pagination
      pageRekap = rekapDosenTerhitung;
      startIdxRekap = 0;
      endIdxRekap = totalRekap;
    } else {
      if (rekapCurrentPage > rekapTotalPages) rekapCurrentPage = rekapTotalPages;
      if (rekapCurrentPage < 1) rekapCurrentPage = 1;

      startIdxRekap = (rekapCurrentPage - 1) * rekapPageSize;
      endIdxRekap = Math.min(startIdxRekap + rekapPageSize, totalRekap);
      pageRekap = rekapDosenTerhitung.slice(startIdxRekap, endIdxRekap);
    }

    if (totalRekap === 0) {
      tbodyDosen.innerHTML = '<tr><td colspan="9" class="pesan" style="border:none;">Tidak ada catatan kehadiran yang terverifikasi pada filter periode ini.</td></tr>';
      if (elPaginationRekap) elPaginationRekap.style.display = 'none';
    } else {
      tbodyDosen.innerHTML = pageRekap.map((d, idx) => {
        const matkulBadges = Object.values(d.matkulMap).map(m => {
          return `<div style="margin-bottom:3px;font-size:12px;">
            <strong>${esc(m.nama)}</strong> 
            <span class="badge semester" style="font-size:10.5px;padding:2px 6px;">${m.sks} SKS</span>
            <span style="color:var(--text-muted);font-size:11px;">(${m.jumlahSesi}x hadir)</span>
          </div>`;
        }).join('');

        const transportNote = d.totalTransport > 0
          ? `<div style="font-size:11px;color:#0284c7;font-weight:600;margin-top:3px;">+ Transport: ${rupiah(d.totalTransport)}</div>`
          : '';

        const listSem = [...d.semesterSet].sort((a, b) => {
          const numA = parseInt(a, 10);
          const numB = parseInt(b, 10);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.localeCompare(b);
        });

        const semesterBadgeHtml = listSem.length > 0
          ? listSem.map(s => `<span class="badge semester">Sem ${esc(s)}</span>`).join(' ')
          : '<span style="color:var(--text-muted);">-</span>';

        return `<tr>
          <td style="color:var(--text-muted);text-align:center;">${startIdxRekap + idx + 1}</td>
          <td><strong>${esc(d.dosen)}</strong></td>
          <td style="text-align:center;">${semesterBadgeHtml}</td>
          <td>${matkulBadges}</td>
          <td style="text-align:center;">
            <span class="badge ok">${d.totalSesi} Sesi</span>
          </td>
          <td style="text-align:center;">
            <strong>${d.totalSksAkumulasi}</strong> SKS
          </td>
          <td>
            <code style="font-size:11.5px;background:var(--surface-subtle);padding:3px 6px;border-radius:4px;border:1px solid var(--border);">
              ${d.totalSksAkumulasi} SKS × Rp 50.000
            </code>
            ${transportNote}
          </td>
          <td style="text-align:right;">
            <span style="font-size:14px;font-weight:700;color:var(--accent);">${rupiah(d.totalHonor)}</span>
          </td>
          <td style="text-align:center;" class="col-aksi">
            <button type="button" class="btn-secondary" style="height:32px;padding:0 10px;font-size:11.5px;" onclick="bukaModalSlip('${esc(d.dosen)}')">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              <span>Slip Gaji</span>
            </button>
          </td>
        </tr>`;
      }).join('');

      if (!isPrintingAllRekap) {
        renderDropdownPagination('paginationRekap', rekapCurrentPage, rekapTotalPages, totalRekap, rekapPageSize, 'gantiHalamanRekap', 'gantiBarisRekap', 'dosen');
      } else if (elPaginationRekap) {
        elPaginationRekap.style.display = 'none';
      }
    }
  }

  // 4. Render Log Sesi Perkuliahan (dengan Pagination)
  const elBadgeJumlahLog = document.getElementById('badgeJumlahLog');
  if (elBadgeJumlahLog) {
    elBadgeJumlahLog.textContent = `${sesiTersaring.length} Sesi (${sesiTerverifikasi.length} Terverifikasi)`;
  }

  const tbodyLog = document.getElementById('tabelLogSesi');
  const elPaginationLog = document.getElementById('paginationLog');

  if (tbodyLog) {
    const logUrut = [...sesiTersaring].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
    const totalLog = logUrut.length;
    const logTotalPages = Math.ceil(totalLog / logPageSize) || 1;

    if (logCurrentPage > logTotalPages) logCurrentPage = logTotalPages;
    if (logCurrentPage < 1) logCurrentPage = 1;

    const startIdxLog = (logCurrentPage - 1) * logPageSize;
    const endIdxLog = Math.min(startIdxLog + logPageSize, totalLog);
    const pageLog = logUrut.slice(startIdxLog, endIdxLog);

    if (totalLog === 0) {
      tbodyLog.innerHTML = '<tr><td colspan="8" class="pesan" style="border:none;">Tidak ada riwayat pertemuan.</td></tr>';
      if (elPaginationLog) elPaginationLog.style.display = 'none';
    } else {
      tbodyLog.innerHTML = pageLog.map(s => {
        const sks = getSks(s.kodeMatkul, s.mataKuliah);
        const honorSesi = sks * TARIF_PER_SKS;
        const statusVerifLower = (s.statusVerifikasi || '').toLowerCase();
        const isVerif = statusVerifLower.includes('terverifikasi');
        const isDitolak = statusVerifLower.includes('ditolak');

        const statusBadgeHtml = isVerif
          ? `<span class="badge ok" title="Sudah diverifikasi oleh Admin">✓ Terverifikasi</span>`
          : (isDitolak
              ? `<span class="badge err" title="Absensi Ditolak oleh Admin">✕ Ditolak</span>`
              : `<span class="badge warn" title="Menunggu verifikasi Admin">Menunggu Verifikasi</span>`);

        const honorTextHtml = isVerif
          ? `<span style="font-weight:700;color:var(--text-primary);">${rupiah(honorSesi)}</span>`
          : `<span style="color:var(--text-muted);font-size:11.5px;font-style:italic;" title="Belum diverifikasi sehingga belum masuk perhitungan honor">Rp 0 (Pending)</span>`;

        return `<tr>
          <td>${formatTanggalSingkat(s.tanggal)}</td>
          <td><strong>${esc(s.dosen)}</strong></td>
          <td>
            <div>${esc(s.mataKuliah || '-')}</div>
            ${s.kodeMatkul ? `<div class="sub-kode">${esc(s.kodeMatkul)}</div>` : ''}
          </td>
          <td style="text-align:center;">
            <span class="badge semester">${sks} SKS</span>
          </td>
          <td>Pertemuan ${esc(s.pertemuan || '-')}</td>
          <td>${esc(s.metode || '-')}</td>
          <td>${statusBadgeHtml}</td>
          <td style="text-align:right;">${honorTextHtml}</td>
        </tr>`;
      }).join('');

      renderDropdownPagination('paginationLog', logCurrentPage, logTotalPages, totalLog, logPageSize, 'gantiHalamanLog', 'gantiBarisLog', 'sesi');
    }
  }
}

// Global scope bindings untuk pagination
window.gantiHalamanRekap = function(page) {
  rekapCurrentPage = Number(page);
  renderGaji();
};

window.gantiBarisRekap = function(newSize) {
  rekapPageSize = Number(newSize) || 10;
  rekapCurrentPage = 1;
  renderGaji();
};

window.gantiHalamanLog = function(page) {
  logCurrentPage = Number(page);
  renderGaji();
};

window.gantiBarisLog = function(newSize) {
  logPageSize = Number(newSize) || 10;
  logCurrentPage = 1;
  renderGaji();
};

// ====== MODAL SLIP GAJI & CETAK ======
const slipModal = document.getElementById('slipModal');
const btnCloseSlip = document.getElementById('btnCloseSlip');
const btnBatalSlip = document.getElementById('btnBatalSlip');
const btnPrintSlip = document.getElementById('btnPrintSlip');
const btnCetakRekap = document.getElementById('btnCetakRekap');

function tutupModalSlip() {
  if (slipModal) slipModal.classList.remove('active');
}

if (btnCloseSlip) btnCloseSlip.addEventListener('click', tutupModalSlip);
if (btnBatalSlip) btnBatalSlip.addEventListener('click', tutupModalSlip);

if (slipModal) {
  slipModal.addEventListener('click', (e) => {
    if (e.target === slipModal) tutupModalSlip();
  });
}

// Helper Pengatur Ukuran & Orientasi Kertas Cetak Dinamis (A4 Portrait / Landscape)
function setPrintPageStyle(cssText) {
  let styleEl = document.getElementById('printPageOrientation');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'printPageOrientation';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = cssText;
}

if (btnPrintSlip) {
  btnPrintSlip.addEventListener('click', () => {
    setPrintPageStyle('@page { size: A4 portrait; margin: 12mm 15mm 15mm 15mm; }');
    document.body.classList.add('is-printing-slip');
    document.body.classList.remove('is-printing-rekap');
    setTimeout(() => {
      window.print();
    }, 50);
  });
}

if (btnCetakRekap) {
  btnCetakRekap.addEventListener('click', () => {
    // Isi meta kop dokumen rekap resmi
    const pBulan = (filterBulan && filterBulan.value) || 'Semua Periode Tercatat';
    const pDosen = (filterDosen && filterDosen.value) ? ` • Dosen: ${filterDosen.value}` : '';
    const elPeriode = document.getElementById('printRekapPeriode');
    const elTglCetak = document.getElementById('printRekapTglCetak');
    const elTglSign = document.getElementById('printRekapTglSign');
    
    if (elPeriode) elPeriode.textContent = pBulan + pDosen;
    if (elTglCetak) elTglCetak.textContent = formatTanggalLengkap(new Date());
    if (elTglSign) elTglSign.textContent = formatTanggalLengkap(new Date());

    setPrintPageStyle('@page { size: A4 landscape; margin: 10mm 12mm 12mm 12mm; }');
    document.body.classList.add('is-printing-rekap');
    document.body.classList.remove('is-printing-slip');
    isPrintingAllRekap = true;
    renderGaji();
    setTimeout(() => {
      window.print();
    }, 80);
  });
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('is-printing-slip');
  document.body.classList.remove('is-printing-rekap');
  if (isPrintingAllRekap) {
    isPrintingAllRekap = false;
    renderGaji();
  }
});

window.bukaModalSlip = function(namaDosen) {
  const dataDosen = rekapDosenTerhitung.find(d => d.dosen === namaDosen);
  if (!dataDosen) return;

  const periodeAktif = (filterBulan && filterBulan.value) || 'Semua Periode Tercatat';
  const tglHariIni = formatTanggalLengkap(new Date());

  const elSlipDosen = document.getElementById('slipDosen');
  const elSlipPeriode = document.getElementById('slipPeriode');
  const elSlipTglCetak = document.getElementById('slipTglCetak');
  const elSlipTglSign = document.getElementById('slipTglSign');
  const elSlipSignDosen = document.getElementById('slipSignDosen');
  const elSlipHonorSks = document.getElementById('slipHonorSks');
  const elSlipTransport = document.getElementById('slipTransport');
  const elSubtotalMatkul = document.getElementById('slipSubtotalMatkul');
  const elTransportTfoot = document.getElementById('slipTransportTfoot');
  const elSlipTotalAmount = document.getElementById('slipTotalAmount');
  const elSlipTabelBody = document.getElementById('slipTabelBody');

  if (elSlipDosen) elSlipDosen.textContent = dataDosen.dosen;
  if (elSlipPeriode) elSlipPeriode.textContent = periodeAktif;
  if (elSlipTglCetak) elSlipTglCetak.textContent = tglHariIni;
  if (elSlipTglSign) elSlipTglSign.textContent = tglHariIni;
  if (elSlipSignDosen) elSlipSignDosen.textContent = '( ' + dataDosen.dosen + ' )';
  if (elSlipHonorSks) elSlipHonorSks.textContent = rupiah(dataDosen.honorPerkuliahan);
  if (elSlipTransport) elSlipTransport.textContent = rupiah(dataDosen.totalTransport);
  if (elSubtotalMatkul) elSubtotalMatkul.textContent = rupiah(dataDosen.honorPerkuliahan);
  if (elTransportTfoot) elTransportTfoot.textContent = rupiah(dataDosen.totalTransport);
  if (elSlipTotalAmount) elSlipTotalAmount.textContent = rupiah(dataDosen.totalHonor);

  if (elSlipTabelBody) {
    const matkulList = Object.values(dataDosen.matkulMap);
    elSlipTabelBody.innerHTML = matkulList.map((m, i) => {
      return `<tr>
        <td class="text-center">${i + 1}</td>
        <td><strong>${esc(m.nama)}</strong> (${esc(m.kode || '-')})</td>
        <td class="text-center">${m.sks}</td>
        <td class="text-center">${m.jumlahSesi} kali</td>
        <td class="text-center"><strong>${m.totalSksMatkul}</strong></td>
        <td class="text-right">Rp 50.000</td>
        <td class="text-right"><strong>${rupiah(m.honorMatkul)}</strong></td>
      </tr>`;
    }).join('');
  }

  if (slipModal) slipModal.classList.add('active');
};

// Global scope binding for modal close
window.tutupModalSlip = tutupModalSlip;

// Mulai periksa autentikasi saat file dibuka
cekSesiLogin();
