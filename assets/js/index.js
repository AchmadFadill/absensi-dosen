/**
 * index.js - Logika Form Absensi Dosen
 * Politeknik IDN Bogor
 */

// ====== KONFIGURASI ======
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby8f0xPX9qMO8eJpaF6XTtzOz8XjCOPJdrGB1LAdzeWGlSAFfN3QJvJl5C8c5Yksfcz/exec';
const SECRET_KEY = 'absensidosenpidnb2026';

// ====== MASTER DATA FALLBACK (DIGUNAKAN JIKA OFFLINE / GAGAL FETCH) ======
const FALLBACK_MASTER = {
  dosen: [
    'Ahmad Fikri Salim, S.Pd, M.Pd',
    'Ari Ramadhan, S.Kom., M.Kom.',
    'Arham, S.Kom.',
    'Febryan, S.Kom., M.Kom.',
    'Oky Tria Saputra, M.Kom'
  ],
  semester: ['1'],
  lokasi: ['Citra Indah', 'Sentul'],
  matkul: [
    { kode: 'RPL-250101', semester: '1', nama: 'English Speaking', dosen: '' },
    { kode: 'RPL-250102', semester: '1', nama: 'Agama Islam 1', dosen: 'Ahmad Fikri Salim, S.Pd, M.Pd' },
    { kode: 'RPL-250103', semester: '1', nama: 'Analisa Perancangan Aplikasi', dosen: 'Febryan, S.Kom., M.Kom.' },
    { kode: 'RPL-250104', semester: '1', nama: 'Struktur Data & Algoritma', dosen: 'Febryan, S.Kom., M.Kom.' },
    { kode: 'RPL-250105', semester: '1', nama: 'Praktikum UI/UX Design', dosen: 'Febryan, S.Kom., M.Kom.' },
    { kode: 'RPL-250106', semester: '1', nama: 'Praktikum Database System', dosen: 'Febryan, S.Kom., M.Kom.' },
    { kode: 'RMG-250101', semester: '1', nama: 'English Speaking', dosen: '' },
    { kode: 'RMG-250102', semester: '1', nama: 'Agama Islam 1', dosen: 'Ahmad Fikri Salim, S.Pd, M.Pd' },
    { kode: 'RMG-250103', semester: '1', nama: 'Visual Design', dosen: 'Arham, S.Kom.' },
    { kode: 'RMG-250104', semester: '1', nama: 'Praktikum Design Fundamental', dosen: 'Arham, S.Kom.' },
    { kode: 'RMG-250105', semester: '1', nama: 'Praktikum Elemen Desain', dosen: 'Arham, S.Kom.' },
    { kode: 'RMG-250106', semester: '1', nama: 'Ilustrasi 2D 3D', dosen: 'Arham, S.Kom.' },
    { kode: 'RKJ-250101', semester: '1', nama: 'English Speaking', dosen: '' },
    { kode: 'RKJ-250102', semester: '1', nama: 'Agama Islam 1', dosen: 'Ahmad Fikri Salim, S.Pd, M.Pd' },
    { kode: 'RKJ-250103', semester: '1', nama: 'Jaringan Dasar', dosen: 'Ari Ramadhan, S.Kom., M.Kom.' },
    { kode: 'RKJ-250104', semester: '1', nama: 'Praktikum Jaringan komputer', dosen: 'Oky Tria Saputra, M.Kom' },
    { kode: 'RKJ-250105', semester: '1', nama: 'Praktikum Networking 1 (MTCNA)', dosen: 'Ari Ramadhan, S.Kom., M.Kom.' },
    { kode: 'RKJ-250106', semester: '1', nama: 'Jaringan Wireless', dosen: 'Oky Tria Saputra, M.Kom' }
  ]
};

let masterData = {
  dosen: [],
  semester: [],
  lokasi: [],
  matkul: []
};

const selDosen = document.getElementById('dosen');
const selSemester = document.getElementById('semester');
const selPertemuan = document.getElementById('pertemuan');
const selMatkul = document.getElementById('kodeMatkul');
const inputTanggal = document.getElementById('tanggal');
const fileInput = document.getElementById('fileBukti');
const dropzone = document.getElementById('dropzone');
const filePreview = document.getElementById('filePreview');
const previewThumb = document.getElementById('previewThumb');
const previewName = document.getElementById('previewName');
const previewSize = document.getElementById('previewSize');
const btnRemoveFile = document.getElementById('btnRemoveFile');
const form = document.getElementById('formAbsensi');
const btnSubmit = document.getElementById('btnSubmit');
const statusBox = document.getElementById('status');

// Inisialisasi dropdown pertemuan (1 - 16)
if (selPertemuan) {
  selPertemuan.innerHTML = '<option value="">-- Pilih Pertemuan --</option>' +
    Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">Pertemuan Ke-${i + 1}</option>`).join('');
}

// Default tanggal hari ini
if (inputTanggal) {
  inputTanggal.value = new Date().toISOString().slice(0, 10);
}

// ====== FILE UPLOAD & PREVIEW LOGIC ======
let activeObjectUrl = null;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function resetFileState() {
  if (fileInput) fileInput.value = '';
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
  if (filePreview) filePreview.classList.remove('active');
  if (dropzone) dropzone.style.display = 'block';
}

function handleFile(file) {
  if (!file) return;

  // Maksimal 8 MB agar aman di kuota Apps Script & Base64
  if (file.size > 8 * 1024 * 1024) {
    if (statusBox) {
      statusBox.className = 'status err';
      statusBox.textContent = 'Ukuran file melebihi 8 MB. Harap pilih foto/dokumen yang lebih kecil.';
    }
    resetFileState();
    return;
  }

  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }

  if (previewName) previewName.textContent = file.name;
  if (previewSize) previewSize.textContent = formatBytes(file.size);

  if (previewThumb) {
    if (file.type.startsWith('image/')) {
      activeObjectUrl = URL.createObjectURL(file);
      previewThumb.innerHTML = `<img src="${activeObjectUrl}" alt="Pratinjau Bukti">`;
    } else {
      previewThumb.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    }
  }

  if (dropzone) dropzone.style.display = 'none';
  if (filePreview) filePreview.classList.add('active');
  if (statusBox) statusBox.className = 'status';
}

if (fileInput) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  });
}

if (btnRemoveFile) {
  btnRemoveFile.addEventListener('click', resetFileState);
}

// Drag & drop listeners
if (dropzone) {
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      fileInput.files = dt.files;
      handleFile(dt.files[0]);
    }
  });
}

// ====== FILTER MATA KULIAH BERDASARKAN SEMESTER & DOSEN ======
function updateMatkulOptions() {
  if (!selMatkul) return;
  const sem = String(selSemester ? selSemester.value : '').trim();
  const dosen = (selDosen ? selDosen.value : '').trim();
  const fieldMatkul = document.getElementById('fieldMatkul') || selMatkul.closest('.field');

  // 1. Jika Dosen dan Semester sama-sama belum dipilih
  if (!dosen && !sem) {
    selMatkul.innerHTML = '<option value="">-- Pilih Dosen & Semester Terlebih Dahulu --</option>';
    selMatkul.disabled = true;
    if (fieldMatkul) fieldMatkul.classList.add('is-disabled');
    return;
  }

  // 2. Jika Dosen belum dipilih
  if (!dosen) {
    selMatkul.innerHTML = '<option value="">-- Pilih Dosen Terlebih Dahulu --</option>';
    selMatkul.disabled = true;
    if (fieldMatkul) fieldMatkul.classList.add('is-disabled');
    return;
  }

  // 3. Jika Semester belum dipilih
  if (!sem) {
    selMatkul.innerHTML = '<option value="">-- Pilih Semester Terlebih Dahulu --</option>';
    selMatkul.disabled = true;
    if (fieldMatkul) fieldMatkul.classList.add('is-disabled');
    return;
  }

  // 4. Kedua parameter (Dosen & Semester) telah terpilih -> aktifkan pilihan
  selMatkul.disabled = false;
  if (fieldMatkul) fieldMatkul.classList.remove('is-disabled');

  const matkulInSem = masterData.matkul.filter(m => String(m.semester) === sem);

  if (matkulInSem.length === 0) {
    selMatkul.innerHTML = '<option value="">-- Tidak ada mata kuliah di semester ini --</option>';
    return;
  }

  const dosenMatkul = matkulInSem.filter(m => m.dosen === dosen);
  const otherMatkul = matkulInSem.filter(m => m.dosen !== dosen);

  let html = '<option value="">-- Pilih Mata Kuliah --</option>';

  if (dosenMatkul.length > 0) {
    html += `<optgroup label="Diampu oleh ${dosen}">`;
    dosenMatkul.forEach(m => {
      const sksBadge = m.sks ? ` (${m.sks} SKS)` : '';
      html += `<option value="${m.kode}">${m.kode} - ${m.nama}${sksBadge}</option>`;
    });
    html += `</optgroup>`;

    if (otherMatkul.length > 0) {
      html += `<optgroup label="Mata Kuliah Lainnya (Semester ${sem})">`;
      otherMatkul.forEach(m => {
        const infoDosen = m.dosen ? ` (${m.dosen})` : '';
        const sksBadge = m.sks ? ` [${m.sks} SKS]` : '';
        html += `<option value="${m.kode}">${m.kode} - ${m.nama}${sksBadge}${infoDosen}</option>`;
      });
      html += `</optgroup>`;
    }
  } else {
    html += `<optgroup label="Semua Mata Kuliah (Semester ${sem})">`;
    matkulInSem.forEach(m => {
      const infoDosen = m.dosen ? ` (${m.dosen})` : '';
      const sksBadge = m.sks ? ` [${m.sks} SKS]` : '';
      html += `<option value="${m.kode}">${m.kode} - ${m.nama}${sksBadge}${infoDosen}</option>`;
    });
    html += `</optgroup>`;
  }

  selMatkul.innerHTML = html;
}

// Auto-suggest semester saat dosen dipilih
if (selDosen) {
  selDosen.addEventListener('change', () => {
    const dosen = selDosen.value;
    if (dosen) {
      const matkulDosen = masterData.matkul.filter(m => m.dosen === dosen);
      const semestersDosen = [...new Set(matkulDosen.map(m => String(m.semester)))];
      // Jika dosen hanya mengajar di satu semester dan semester belum dipilih
      if (semestersDosen.length === 1 && selSemester && !selSemester.value) {
        selSemester.value = semestersDosen[0];
      }
    }
    updateMatkulOptions();
  });
}

if (selSemester) {
  selSemester.addEventListener('change', updateMatkulOptions);
}

// ====== POPULASI MASTER DATA ======
function renderMasterOptions() {
  if (selDosen) {
    selDosen.innerHTML = '<option value="">-- Pilih Dosen Pengampu --</option>' +
      masterData.dosen.map(d => `<option value="${d}">${d}</option>`).join('');
  }

  if (selSemester) {
    selSemester.innerHTML = '<option value="">-- Pilih Semester --</option>' +
      masterData.semester.map(s => `<option value="${s}">Semester ${s}</option>`).join('');
  }

  // Populasi Lokasi Mengajar (berdasarkan kolom Lokasi di tab Matkul)
  const selLokasi = document.getElementById('lokasi');
  if (selLokasi) {
    selLokasi.innerHTML = '<option value="">-- Pilih Lokasi Mengajar --</option>' +
      (masterData.lokasi || []).map(l => `<option value="${l}">${l}</option>`).join('');
  }

  updateMatkulOptions();
}

async function loadMasterData() {
  try {
    const res = await fetch(SCRIPT_URL + '?action=master');
    const json = await res.json();
    if (json && json.status === 'ok') {
      masterData = {
        dosen: json.dosen || FALLBACK_MASTER.dosen,
        semester: (json.semester && json.semester.length > 0) ? json.semester.map(String) : FALLBACK_MASTER.semester,
        lokasi: (json.lokasi && json.lokasi.length > 0) ? json.lokasi : FALLBACK_MASTER.lokasi,
        matkul: (json.matkul && json.matkul.length > 0) ? json.matkul : FALLBACK_MASTER.matkul
      };
    } else {
      masterData = FALLBACK_MASTER;
    }
  } catch (err) {
    console.warn('Gagal memuat master data dinamis dari Apps Script, menggunakan data lokal:', err);
    masterData = FALLBACK_MASTER;
  }
  renderMasterOptions();
}

loadMasterData();

// Helper konversi file ke Base64 (tanpa header data URL)
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const commaIdx = result.indexOf(',');
      resolve(commaIdx !== -1 ? result.substring(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

// ====== KIRIM ABSENSI KE APPS SCRIPT ======
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const file = fileInput.files ? fileInput.files[0] : null;
    if (!file) {
      statusBox.className = 'status err';
      statusBox.textContent = 'Harap unggah bukti kelas sebelum mengirim absensi.';
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      statusBox.className = 'status err';
      statusBox.textContent = 'Ukuran file melebihi 8 MB. Harap kurangi ukuran file.';
      return;
    }

    const kodeMatkul = selMatkul.value;
    const semester = String(selSemester.value);
    const dosen = selDosen.value;
    const pertemuan = selPertemuan.value;
    const tanggal = inputTanggal.value;
    const linkMateri = document.getElementById('linkMateri').value.trim();
    const statusKehadiran = document.getElementById('statusKehadiran').value;
    const metode = document.getElementById('metode').value;
    const lokasi = document.getElementById('lokasi').value.trim();

    if (!kodeMatkul || !semester || !dosen || !pertemuan || !tanggal || !linkMateri || !statusKehadiran || !metode || !lokasi) {
      statusBox.className = 'status err';
      statusBox.textContent = 'Harap lengkapi semua kolom bertanda bintang (*).';
      return;
    }

    if (!['Online', 'Offline', 'Hybrid'].includes(metode)) {
      statusBox.className = 'status err';
      statusBox.textContent = 'Metode pembelajaran harus Online, Offline, atau Hybrid.';
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Mengonversi bukti kelas...';
    statusBox.className = 'status';

    try {
      const fileBase64 = await readFileAsBase64(file);

      btnSubmit.textContent = 'Menyimpan absensi ke server...';

      const payload = {
        secret: SECRET_KEY,
        dosen: dosen,
        semester: semester,
        kodeMatkul: kodeMatkul,
        pertemuan: parseInt(pertemuan, 10),
        tanggal: tanggal,
        linkMateri: linkMateri,
        statusKehadiran: statusKehadiran,
        lokasi: lokasi,
        metode: metode,
        fileBase64: fileBase64,
        namaFile: file.name,
        mimeFile: file.type || 'image/jpeg'
      };

      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      let json = null;
      try {
        json = await res.json();
      } catch (parseErr) {}

      if (json && json.status === 'ok') {
        statusBox.className = 'status ok';
        statusBox.textContent = json.message || 'Data absensi dan bukti kelas berhasil disimpan.';
        form.reset();
        resetFileState();
        inputTanggal.value = new Date().toISOString().slice(0, 10);
        updateMatkulOptions();
      } else if (json && json.status === 'error') {
        statusBox.className = 'status err';
        statusBox.textContent = 'Gagal menyimpan: ' + (json.message || 'Terjadi kesalahan pada sistem.');
      } else {
        statusBox.className = 'status ok';
        statusBox.textContent = 'Absensi berhasil dikirim.';
        form.reset();
        resetFileState();
        inputTanggal.value = new Date().toISOString().slice(0, 10);
        updateMatkulOptions();
      }
    } catch (err) {
      statusBox.className = 'status err';
      statusBox.textContent = 'Gagal mengirim data. Periksa koneksi internet lalu coba lagi.';
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Kirim Absensi';
    }
  });
}
