let myName = null;

const errorBox = document.getElementById('error-box');
const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');
const myNameEl = document.getElementById('my-name');
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');

const participantsCountEl = document.getElementById('participants-count');
const participantsListEl = document.getElementById('participants-list');

const proposeForm = document.getElementById('propose-form');
const productIdsInput = document.getElementById('product-ids-input');
const proposeBtn = document.getElementById('propose-btn');
const proposeFeedback = document.getElementById('propose-feedback');

const productsListEl = document.getElementById('products-list');

// Conectar al WebSocket en el mismo host y puerto
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

// Exponer ws en window para poder probar mensajes inválidos desde la consola (F12)
window.ws = ws;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'welcome') {
    clearError();
    myName = msg.name;
    myNameEl.textContent = myName;
    loginSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    renderState(msg.participants, msg.products);
    return;
  }

  if (msg.type === 'state_update') {
    renderState(msg.participants, msg.products);
    return;
  }

  if (msg.type === 'proposal_result') {
    proposeBtn.disabled = false;
    proposeBtn.textContent = 'Proponer';
    renderProposalResult(msg.added, msg.rejected);
    return;
  }

  if (msg.type === 'error') {
    proposeBtn.disabled = false;
    proposeBtn.textContent = 'Proponer';
    showError(`[${msg.code}] ${msg.message}`);
    return;
  }
});

ws.addEventListener('close', () => {
  showError('Se perdió la conexión con el servidor.');
});

// Enviar 'join'
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearError();
  ws.send(JSON.stringify({ type: 'join', name: nameInput.value }));
});

// Enviar 'propose'
proposeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearError();
  proposeFeedback.innerHTML = '';

  const rawParts = productIdsInput.value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const productIds = rawParts.map((s) => Number(s));

  proposeBtn.disabled = true;
  proposeBtn.textContent = 'Consultando catálogo...';

  ws.send(JSON.stringify({ type: 'propose', productIds }));
  productIdsInput.value = '';
});

function renderProposalResult(added, rejected) {
  let html = '';

  if (added.length > 0) {
    html += `<div class="alert alert-success">Productos agregados: ${added.map((id) => '#' + id).join(', ')}</div>`;
  }

  if (rejected.length > 0) {
    const items = rejected
      .map((r) => `<li><strong>#${r.id}</strong> (${r.reason}): ${r.message}</li>`)
      .join('');
    html += `<div class="alert alert-error"><strong>No se pudieron agregar:</strong><ul style="margin:6px 0 0 0;">${items}</ul></div>`;
  }

  proposeFeedback.innerHTML = html;
}

function renderState(participants, products) {
  // 1. Renderizar participantes conectados
  participantsCountEl.textContent = String(participants.length);
  participantsListEl.innerHTML = participants
    .map((name) => `<span class="badge">${escapeHtml(name)}</span>`)
    .join('');

  // 2. Renderizar productos
  if (products.length === 0) {
    productsListEl.innerHTML = '<p style="color:#64748b;">Todavía no hay productos propuestos.</p>';
    return;
  }

  productsListEl.innerHTML = products
    .map((p) => {
      const hasVoted = p.votes.includes(myName);
      const isOwner = p.proposedBy === myName;
      const votersText = p.votes.length > 0 ? `Votaron: ${p.votes.map(escapeHtml).join(', ')}` : 'Sin votos aún';

      return `
        <div class="product-item">
          <div class="product-info">
            <img src="${escapeHtml(p.thumbnail)}" alt="${escapeHtml(p.title)}" />
            <div>
              <strong>#${p.id} · ${escapeHtml(p.title)}</strong>
              <div style="font-size: 14px; color: #0f172a; margin: 4px 0;">Precio: $${p.price}</div>
              <div style="font-size: 12px; color: #64748b;">
                Propuesto por: <strong>${escapeHtml(p.proposedBy)}</strong> · ${votersText}
              </div>
            </div>
          </div>

          <div class="product-actions">
            <div class="vote-count">${p.votes.length} voto${p.votes.length === 1 ? '' : 's'}</div>
            ${
              hasVoted
                ? `<button class="secondary" onclick="sendUnvote(${p.id})">Retirar voto</button>`
                : `<button onclick="sendVote(${p.id})">Votar</button>`
            }
            ${
              isOwner
                ? `<button class="danger" onclick="sendRemove(${p.id})">Quitar</button>`
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');
}

window.sendVote = function (productId) {
  clearError();
  ws.send(JSON.stringify({ type: 'vote', productId }));
};

window.sendUnvote = function (productId) {
  clearError();
  ws.send(JSON.stringify({ type: 'unvote', productId }));
};

window.sendRemove = function (productId) {
  clearError();
  ws.send(JSON.stringify({ type: 'remove', productId }));
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}