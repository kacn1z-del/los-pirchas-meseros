// Tarjeta de cliente frecuente: escaneo del QR, búsqueda por teléfono y suma
// de puntos al cobrar. Se importa desde index.html con los mismos módulos de
// Firebase que ya usa la app (la instancia de db se pasa como parámetro).
import {
  collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Reglas del programa (deben coincidir con src/lib/puntos.js del cliente).
const PUNTOS_POR_COLON = 1000; // 1 punto (y 1 sello) por cada ₡1.000 cobrados

export function normalizarTelefono(raw) {
  const digitos = String(raw || '').replace(/\D/g, '');
  if (digitos.length === 8) return `506${digitos}`;
  if (digitos.length === 11 && digitos.startsWith('506')) return digitos;
  return null;
}

export async function buscarPorTelefono(db, telefono) {
  const id = normalizarTelefono(telefono);
  if (!id) return null;
  const snap = await getDoc(doc(db, 'clientes', id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

export async function buscarPorTarjetaId(db, tarjetaId) {
  const snap = await getDocs(query(collection(db, 'clientes'), where('tarjetaId', '==', tarjetaId)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// Suma los puntos del cobro al cliente. Usa una transacción y una marca en el
// pedido (puntosSumados) para que nunca se sumen dos veces el mismo pedido.
export async function sumarPuntos(db, orderId, telefono, total, envioExpress = 0) {
  const id = normalizarTelefono(telefono);
  if (!id) return 0;
  const base = Math.max(0, Number(total || 0) - Number(envioExpress || 0));
  const puntos = Math.floor(base / PUNTOS_POR_COLON);
  if (puntos <= 0) return 0;
  const orderRef = doc(db, 'orders', orderId);
  const clienteRef = doc(db, 'clientes', id);
  return runTransaction(db, async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists() || orderSnap.data().puntosSumados) return 0;
    const clienteSnap = await tx.get(clienteRef);
    if (!clienteSnap.exists()) return 0;
    const actuales = Number(clienteSnap.data().puntos || 0);
    tx.update(clienteRef, { puntos: actuales + puntos, ultimaVisita: serverTimestamp() });
    tx.update(orderRef, { puntosSumados: puntos, clienteTelefono: id });
    return puntos;
  });
}

// Overlay con la cámara trasera. Resuelve con el texto del QR o null si se cancela.
export function escanearQR() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;';
    overlay.innerHTML =
      '<video playsinline muted style="width:100%;max-width:360px;border-radius:12px;background:#000"></video>' +
      '<canvas style="display:none"></canvas>' +
      '<p style="color:#fff;font-size:14px;margin:0;text-align:center">Apuntá la cámara al código de la tarjeta</p>' +
      '<button type="button" style="padding:10px 18px;border-radius:10px;border:none;font-weight:700">Cancelar</button>';
    document.body.appendChild(overlay);

    const video = overlay.querySelector('video');
    const canvas = overlay.querySelector('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let stream = null;
    let activo = true;

    const cerrar = (valor) => {
      activo = false;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
      resolve(valor);
    };

    overlay.querySelector('button').onclick = () => cerrar(null);

    const loop = () => {
      if (!activo) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(img.data, img.width, img.height);
        if (code && code.data) return cerrar(code.data);
      }
      requestAnimationFrame(loop);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        video.srcObject = s;
        video.play();
        loop();
      })
      .catch(() => {
        alert('No se pudo abrir la cámara. Revisá los permisos o escribí el teléfono.');
        cerrar(null);
      });
  });
}

// Flujo para asociar un cliente al cobro: escanear el QR o escribir el teléfono.
export async function elegirCliente(db) {
  const usarCamara = window.confirm(
    '¿Escanear la tarjeta con la cámara?\n\nAceptar = escanear. Cancelar = escribir el teléfono.'
  );
  if (usarCamara) {
    const texto = await escanearQR();
    if (!texto) return null;
    const cliente = await buscarPorTarjetaId(db, texto);
    if (!cliente) alert('Esa tarjeta no existe en el sistema.');
    return cliente;
  }
  const tel = window.prompt('Teléfono del cliente:');
  if (!tel) return null;
  const cliente = await buscarPorTelefono(db, tel);
  if (!cliente) alert('No hay tarjeta con ese teléfono.');
  return cliente;
}
