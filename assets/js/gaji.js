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
let daftarPasswordSah = ['adminidn2026', 'absensidosenpidnb2026']; // Default fallback jika offline

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

// ====== SINKRONISASI MASTER DATA LANGSUNG SAAT HALAMAN DIBUKA ======
let masterFetchPromise = null;

async function ambilMasterData() {
  try {
    const res = await fetch(SCRIPT_URL + '?action=master');
    const json = await res.json();
    if (json && json.status === 'ok') {
      masterData = json;

      // Ambil daftar password dari Kolom J yang dikirimkan Apps Script
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

      if (sandiServer.length > 0) {
        daftarPasswordSah = [...new Set([...sandiServer, ...daftarPasswordSah])];
      }

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
      btnUnlock.innerHTML = '<span>Memverifikasi kata sandi...</span>';
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
        lockAlert.innerHTML = '<strong>Kata sandi tidak sesuai.</strong><br>' +
          'Silakan periksa kata sandi di Kolom J Sheet Matkul. Jika baru ditambahkan/diubah di Spreadsheet, pastikan file Apps Script sudah di-<strong>Deploy > Manage deployments > New version</strong>.';
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
        '<div style="color:var(--error);font-weight:600;margin-bottom:6px;">Gagal memuat data honor.</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);">' + esc(err.message) + '</div>';
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

[filterBulan, filterDosen, filterStatus].forEach(el => {
  if (el) el.addEventListener('change', renderGaji);
});

// ====== KALKULASI & RENDER GAJI ======
let rekapDosenTerhitung = [];

function renderGaji() {
  const pBulan = filterBulan ? filterBulan.value : '';
  const pDosen = filterDosen ? filterDosen.value : '';
  const pStatus = filterStatus ? filterStatus.value : 'Hadir';

  // Filter Sesi Kehadiran
  const sesiTersaring = rawAbsensi.filter(d => {
    const cocokBulan = !pBulan || formatBulanTahun(d.tanggal) === pBulan;
    const cocokDosen = !pDosen || (d.dosen || '').trim() === pDosen;
    const cocokStatus = pStatus === 'Semua' ? true : (d.statusKehadiran || '').toLowerCase() === 'hadir';
    return cocokBulan && cocokDosen && cocokStatus;
  });

  // 1. Grouping per Dosen
  const perDosen = {};

  sesiTersaring.forEach(sesi => {
    const dosen = (sesi.dosen || 'Tanpa Nama').trim();
    const kode = sesi.kodeMatkul || '-';
    const namaMk = sesi.mataKuliah || '-';
    const keyMk = kode !== '-' ? kode : namaMk;
    const sks = getSks(kode, namaMk);

    if (!perDosen[dosen]) {
      perDosen[dosen] = {
        dosen: dosen,
        matkulMap: {},
        totalSesi: 0,
        totalSksAkumulasi: 0,
        totalHonor: 0
      };
    }

    if (!perDosen[dosen].matkulMap[keyMk]) {
      perDosen[dosen].matkulMap[keyMk] = {
        kode: kode,
        nama: namaMk,
        sks: sks,
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
    perDosen[dosen].totalHonor += (sks * TARIF_PER_SKS);
  });

  rekapDosenTerhitung = Object.values(perDosen);

  // 2. Hitung KPI Keseluruhan
  const totalSemuaHonor = rekapDosenTerhitung.reduce((acc, d) => acc + d.totalHonor, 0);
  const totalSemuaSks = rekapDosenTerhitung.reduce((acc, d) => acc + d.totalSksAkumulasi, 0);
  const totalSemuaSesi = sesiTersaring.length;

  const elTotalGaji = document.getElementById('kpiTotalGaji');
  const elTotalSks = document.getElementById('kpiTotalSks');
  const elTotalSesi = document.getElementById('kpiTotalSesi');

  if (elTotalGaji) elTotalGaji.textContent = rupiah(totalSemuaHonor);
  if (elTotalSks) elTotalSks.textContent = totalSemuaSks + ' SKS';
  if (elTotalSesi) elTotalSesi.textContent = totalSemuaSesi + ' Sesi';

  // 3. Render Tabel Rekapitulasi per Dosen
  const tbodyDosen = document.getElementById('tabelRekapDosen');
  if (tbodyDosen) {
    if (rekapDosenTerhitung.length === 0) {
      tbodyDosen.innerHTML = '<tr><td colspan="8" class="pesan" style="border:none;">Tidak ada catatan kehadiran pada filter periode ini.</td></tr>';
    } else {
      tbodyDosen.innerHTML = rekapDosenTerhitung.map((d, idx) => {
        const matkulBadges = Object.values(d.matkulMap).map(m => {
          return `<div style="margin-bottom:3px;font-size:12px;">
            <strong>${esc(m.nama)}</strong> 
            <span class="badge semester" style="font-size:10.5px;padding:2px 6px;">${m.sks} SKS</span>
            <span style="color:var(--text-muted);font-size:11px;">(${m.jumlahSesi}x hadir)</span>
          </div>`;
        }).join('');

        return `<tr>
          <td style="color:var(--text-muted);">${idx + 1}</td>
          <td><strong>${esc(d.dosen)}</strong></td>
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
          </td>
          <td style="text-align:right;">
            <span style="font-size:14px;font-weight:700;color:var(--accent);">${rupiah(d.totalHonor)}</span>
          </td>
          <td style="text-align:center;">
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
    }
  }

  // 4. Render Log Sesi Perkuliahan
  const elBadgeJumlahLog = document.getElementById('badgeJumlahLog');
  if (elBadgeJumlahLog) elBadgeJumlahLog.textContent = sesiTersaring.length + ' Sesi';

  const tbodyLog = document.getElementById('tabelLogSesi');
  if (tbodyLog) {
    const logUrut = [...sesiTersaring].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

    if (logUrut.length === 0) {
      tbodyLog.innerHTML = '<tr><td colspan="8" class="pesan" style="border:none;">Tidak ada riwayat pertemuan.</td></tr>';
    } else {
      tbodyLog.innerHTML = logUrut.slice(0, 30).map(s => {
        const sks = getSks(s.kodeMatkul, s.mataKuliah);
        const honorSesi = sks * TARIF_PER_SKS;
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
          <td><span class="badge ok">${esc(s.statusKehadiran || 'Hadir')}</span></td>
          <td style="text-align:right;font-weight:700;color:var(--text-primary);">${rupiah(honorSesi)}</td>
        </tr>`;
      }).join('');
    }
  }
}

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

if (btnPrintSlip) {
  btnPrintSlip.addEventListener('click', () => {
    window.print();
  });
}

if (btnCetakRekap) {
  btnCetakRekap.addEventListener('click', () => {
    window.print();
  });
}

window.bukaModalSlip = function(namaDosen) {
  const dataDosen = rekapDosenTerhitung.find(d => d.dosen === namaDosen);
  if (!dataDosen) return;

  const periodeAktif = (filterBulan && filterBulan.value) || 'Semua Periode Tercatat';
  const tglHariIni = formatTanggalSingkat(new Date().toISOString());

  const elSlipDosen = document.getElementById('slipDosen');
  const elSlipPeriode = document.getElementById('slipPeriode');
  const elSlipTglCetak = document.getElementById('slipTglCetak');
  const elSlipTglSign = document.getElementById('slipTglSign');
  const elSlipSignDosen = document.getElementById('slipSignDosen');
  const elSlipTotalAmount = document.getElementById('slipTotalAmount');
  const elSlipTabelBody = document.getElementById('slipTabelBody');

  if (elSlipDosen) elSlipDosen.textContent = dataDosen.dosen;
  if (elSlipPeriode) elSlipPeriode.textContent = periodeAktif;
  if (elSlipTglCetak) elSlipTglCetak.textContent = tglHariIni;
  if (elSlipTglSign) elSlipTglSign.textContent = tglHariIni;
  if (elSlipSignDosen) elSlipSignDosen.textContent = '( ' + dataDosen.dosen + ' )';
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
