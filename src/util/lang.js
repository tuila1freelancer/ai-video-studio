// Language detection (per scene text) — shared by TTS façade and voice providers.
export function detectLang(text) {
  const s = String(text || '');
  if (/[ạảãàáâậầấẩẫăắằẳẵặẹẻẽèéêệềếểễịỉĩìíọỏõòóôộồốổỗơớờởỡợụủũùúưứừửữựỳýỵỷỹđ]/i.test(s)) return 'vi';
  if (/[぀-ヿ]/.test(s)) return 'ja';
  if (/[가-힯]/.test(s)) return 'ko';
  if (/[一-鿿]/.test(s)) return 'zh';
  if (/[Ѐ-ӿ]/.test(s)) return 'ru';
  return 'en';
}
