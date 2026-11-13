const bridge = window.chrome.webview;
const form = document.querySelector('#password-form');
const loading = document.querySelector('#loading');
const close = document.querySelector('#close');
const error = document.querySelector('#error');
const acknowledged = document.querySelector('#acknowledged');
const newPassword = document.querySelector('#new-password');
const confirmPassword = document.querySelector('#confirm-password');
const localPassword = document.querySelector('#password');
let step;

function show(next, message = '') {
  step = next;
  for (const section of form.querySelectorAll('section')) section.hidden = section.id !== next;
  form.hidden = false;
  loading.hidden = true;
  close.disabled = false;
  error.textContent = message;
  form.querySelector('section:not([hidden]) input[type=password]').focus();
}

bridge.addEventListener('message', ({ data }) => {
  if (typeof data.setup === 'boolean') show(data.setup ? 'choose' : 'enter');
  if (data.error) show(step === 'enter' ? 'enter' : 'choose', data.error);
});
close.addEventListener('click', () => bridge.postMessage({ action: 'close' }));
document.querySelector('#back').addEventListener('click', () => show('choose'));
document.querySelector('#recover').addEventListener('click', () => bridge.postMessage({ action: 'recover' }));

form.addEventListener('submit', event => {
  event.preventDefault();
  if (step === 'choose') {
    if (newPassword.value.length < 8) return show('choose', 'Use at least eight characters. / En az sekiz karakter kullan.');
    show('confirm');
    return;
  }
  if (step === 'confirm' && newPassword.value !== confirmPassword.value)
    return show('confirm', 'Passwords must match. / Parolalar eşleşmeli.');
  if (step === 'confirm' && !acknowledged.checked)
    return show('confirm', 'Confirm the recovery note. / Kurtarma notunu onayla.');
  const password = step === 'enter' ? localPassword.value : newPassword.value;
  if (!password) return show('enter', 'Enter your local password. / Yerel parolanı gir.');
  for (const input of form.querySelectorAll('input[type=password]')) input.value = '';
  form.hidden = true;
  loading.hidden = false;
  close.disabled = true;
  bridge.postMessage({ action: 'unlock', password, acknowledged: acknowledged.checked });
});

bridge.postMessage({ action: 'ready' });
