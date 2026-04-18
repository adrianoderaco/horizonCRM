// Arquivo: js/client/app.js
import { clientAPI } from './api.js';

const App = {
    ticketId: null,

    async init() {
        window.clientApp = this;
        console.log("🚀 Iniciando App do Cliente...");

        // Carrega as opções no dropdown
        await this.loadSubjects();

        const registerForm = document.getElementById('register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = e.target.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;
                btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Aguarde...`;
                
                const name = document.getElementById('cust-name').value;
                const email = document.getElementById('cust-email').value;
                const phone = document.getElementById('cust-phone').value;
                const subjectId = document.getElementById('cust-subject').value;
                const initialMessage = document.getElementById('cust-message').value;

                try {
                    let customer = await clientAPI.checkCustomer(email);
                    if (!customer) {
                        customer = await clientAPI.createCustomer({ full_name: name, email: email, phone: phone });
                    }
                    
                    // 1. Cria o Ticket
                    const ticket = await clientAPI.createTicket(customer.id, subjectId);
                    this.ticketId = ticket.id;
                    
                    // 2. Muda para a tela de Chat
                    this.navigate('chat');
                    document.getElementById('header-desc').innerText = `Protocolo HZ-${ticket.protocol_number}`;
                    
                    // 3. Imprime as boas-vindas do sistema
                    this.renderMsg("Olá! Recebemos seu chamado e um analista logo irá te atender.", 'system');

                    // 4. Envia a mensagem inicial do cliente imediatamente para o banco e pinta na tela
                    await clientAPI.sendMessage(this.ticketId, initialMessage);
                    this.renderMsg(initialMessage, 'customer');

                    // 5. Escuta atualizações de status do Ticket (Liberar upload ou Fechar/NPS)
                    clientAPI.subscribeToTicket(this.ticketId, (t) => {
                        if (t.status === 'closed') {
                            this.navigate('nps');
                            this.renderNPSButtons();
                        }
                        const btnAttach = document.getElementById('btn-attach');
                        if (btnAttach) {
                            if (t.is_upload_enabled) btnAttach.classList.remove('hidden-view');
                            else btnAttach.classList.add('hidden-view');
                        }
                    });

                    // 6. Escuta as respostas do Agente
                    clientAPI.subscribeToMessages(this.ticketId, (msg, fUrl, fName, fType) => {
                        this.renderMsg(msg, 'agent', fUrl, fName, fType);
                    });

                } catch (err) {
                    console.error("❌ Erro ao registrar/criar ticket:", err);
                    alert("Erro ao iniciar atendimento. Verifique sua conexão e tente novamente.");
                    btn.innerHTML = originalText;
                }
            });
        }

        const chatForm = document.getElementById('chat-form');
        if (chatForm) {
            chatForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const input = document.getElementById('chat-input');
                const text = input.value.trim();
                if(!text || !this.ticketId) return;
                
                this.renderMsg(text, 'customer');
                input.value = '';
                
                try {
                    await clientAPI.sendMessage(this.ticketId, text);
                } catch(e) { console.error("❌ Erro ao enviar msg:", e); }
            });
        }

        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if(!file) return;
                
                document.getElementById('upload-progress').classList.remove('hidden-view');
                document.getElementById('btn-send').disabled = true;
                
                try {
                    const fileData = await clientAPI.uploadFile(file);
                    await clientAPI.sendMessage(this.ticketId, "📎 Anexo enviado pelo cliente:", fileData);
                    this.renderMsg("📎 Anexo enviado:", 'customer', fileData.url, fileData.name, fileData.type);
                } catch(err) {
                    console.error("❌ Erro no upload:", err);
                    alert("Erro ao enviar o arquivo. O arquivo pode ser muito grande.");
                } finally {
                    document.getElementById('upload-progress').classList.add('hidden-view');
                    document.getElementById('btn-send').disabled = false;
                    e.target.value = ''; 
                }
            });
        }
    },

    navigate(target) {
        ['register', 'chat', 'nps'].forEach(s => {
            const el = document.getElementById(`sec-${s}`);
            if (el) el.classList.add('hidden-view');
        });
        const targetEl = document.getElementById(`sec-${target}`);
        if (targetEl) targetEl.classList.remove('hidden-view');
    },

    async loadSubjects() {
        const selectEl = document.getElementById('cust-subject');
        if (!selectEl) return;
        
        try {
            const subjects = await clientAPI.getActiveSubjects();
            if (!subjects || subjects.length === 0) {
                selectEl.innerHTML = `<option value="" disabled selected>Nenhum assunto disponível</option>`;
                return;
            }
            selectEl.innerHTML = `<option value="" disabled selected>Selecione um Assunto...</option>` + 
                subjects.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
        } catch (e) {
            console.error("❌ Erro ao buscar assuntos:", e);
            selectEl.innerHTML = `<option value="" disabled selected>Erro ao carregar assuntos</option>`;
        }
    },

    renderMsg(text, type, fileUrl = null, fileName = null, fileType = null) {
        const area = document.getElementById('chat-messages');
        if (!area) return;

        let mediaHtml = '';
        if (fileUrl) {
            if (fileType && fileType.startsWith('image/')) {
                mediaHtml = `<div class="mt-2"><a href="${fileUrl}" target="_blank"><img src="${fileUrl}" class="max-w-[200px] rounded-lg border hover:opacity-80 transition-opacity"></a></div>`;
            } else {
                mediaHtml = `<div class="mt-2"><a href="${fileUrl}" target="_blank" download class="flex items-center gap-1 bg-black/10 p-2 rounded text-[10px] font-bold text-inherit hover:bg-black/20 transition-colors"><span class="material-symbols-outlined text-xs">download</span> ${fileName || 'Arquivo'}</a></div>`;
            }
        }

        if (type === 'system') {
            area.innerHTML += `<div class="flex justify-center w-full"><div class="bg-blue-50 text-blue-800 text-xs font-bold px-4 py-2 rounded-full border border-blue-100 text-center">${text}</div></div>`;
        } else {
            const isMe = type === 'customer';
            area.innerHTML += `
                <div class="flex ${isMe ? 'justify-end' : 'justify-start'} w-full">
                    <div class="max-w-[85%] p-4 rounded-2xl text-sm font-medium shadow-sm ${isMe ? 'bg-slate-900 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'}">
                        ${text}${mediaHtml}
                    </div>
                </div>`;
        }
        area.scrollTop = area.scrollHeight;
    },

    renderNPSButtons() {
        const container = document.getElementById('nps-buttons');
        if (!container) return;
        let html = '';
        for(let i=1; i<=10; i++) {
            let colorClass = i <= 6 ? 'bg-red-100 text-red-600 hover:bg-red-500 hover:text-white' : i <= 8 ? 'bg-amber-100 text-amber-600 hover:bg-amber-500 hover:text-white' : 'bg-green-100 text-green-600 hover:bg-green-500 hover:text-white';
            html += `<button onclick="clientApp.submitNPS(${i}, this)" class="flex-1 h-10 sm:h-12 rounded-lg sm:rounded-xl font-black text-sm sm:text-base transition-all flex items-center justify-center ${colorClass}">${i}</button>`;
        }
        container.innerHTML = html;
    },

    async submitNPS(rating, btnElement) {
        document.querySelectorAll('#nps-buttons button').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
        btnElement.style.opacity = '1'; 
        btnElement.style.transform = 'scale(1.1)';
        try {
            await clientAPI.submitNPS(this.ticketId, rating);
            document.getElementById('nps-thanks').classList.remove('hidden-view');
        } catch (e) { 
            console.error(e);
            alert("Erro ao salvar avaliação."); 
        }
    }
};

App.init();