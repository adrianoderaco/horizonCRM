import { clientAPI } from './api.js';

const App = {
    selectedSubject: null,
    ticketId: null,

    async init() {
        window.clientApp = this;
        await this.loadSubjects();

        document.getElementById('register-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Aguarde...`;
            
            const name = document.getElementById('cust-name').value;
            const email = document.getElementById('cust-email').value;
            const phone = document.getElementById('cust-phone').value;

            try {
                let customer = await clientAPI.checkCustomer(email);
                if (!customer) {
                    customer = await clientAPI.createCustomer({ full_name: name, email: email, phone: phone });
                }
                const ticket = await clientAPI.createTicket(customer.id, this.selectedSubject);
                this.ticketId = ticket.id;
                
                this.navigate('chat');
                document.getElementById('header-desc').innerText = `Protocolo HZ-${ticket.protocol_number}`;
                
                this.renderMsg("Olá! Recebemos seu chamado e um analista logo irá te atender.", 'system');

                clientAPI.subscribeToTicket(this.ticketId, (t) => {
                    if (t.status === 'closed') {
                        this.navigate('nps');
                        this.renderNPSButtons();
                    }
                    if (t.is_upload_enabled) {
                        document.getElementById('btn-attach').classList.remove('hidden-view');
                    } else {
                        document.getElementById('btn-attach').classList.add('hidden-view');
                    }
                });

                clientAPI.subscribeToMessages(this.ticketId, (msg, fUrl, fName, fType) => {
                    this.renderMsg(msg, 'agent', fUrl, fName, fType);
                });

            } catch (err) {
                alert("Erro ao iniciar chat: " + err.message);
                btn.innerHTML = `Tentar Novamente`;
            }
        });

        document.getElementById('chat-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if(!text || !this.ticketId) return;
            this.renderMsg(text, 'customer');
            input.value = '';
            await clientAPI.sendMessage(this.ticketId, text);
        });

        document.getElementById('file-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if(!file) return;
            
            document.getElementById('upload-progress').classList.remove('hidden-view');
            document.getElementById('btn-send').disabled = true;
            
            try {
                const fileData = await clientAPI.uploadFile(file);
                await clientAPI.sendMessage(this.ticketId, "📎 Anexo enviado pelo cliente:", fileData);
                this.renderMsg("📎 Anexo enviado:", 'customer', fileData.url, fileData.name, fileData.type);
            } catch(err) {
                alert("Erro no upload: " + err.message);
            } finally {
                document.getElementById('upload-progress').classList.add('hidden-view');
                document.getElementById('btn-send').disabled = false;
                e.target.value = ''; 
            }
        });
    },

    navigate(target) {
        ['subjects', 'register', 'chat', 'nps'].forEach(s => document.getElementById(`sec-${s}`).classList.add('hidden-view'));
        document.getElementById(`sec-${target}`).classList.remove('hidden-view');
    },

    async loadSubjects() {
        const container = document.getElementById('subject-list');
        try {
            const subjects = await clientAPI.getActiveSubjects();
            container.innerHTML = subjects.map(s => `<button onclick="clientApp.selectSubject('${s.id}')" class="w-full text-left p-4 bg-white border border-slate-200 rounded-2xl hover:border-blue-600 hover:shadow-md transition-all font-bold text-slate-700 flex justify-between items-center group">${s.label} <span class="material-symbols-outlined text-slate-300 group-hover:text-blue-600">chevron_right</span></button>`).join('');
        } catch (e) {
            container.innerHTML = `<div class="text-center text-red-500 font-bold">Erro ao carregar opções.</div>`;
        }
    },

    selectSubject(id) {
        this.selectedSubject = id;
        this.navigate('register');
    },

    renderMsg(text, type, fileUrl = null, fileName = null, fileType = null) {
        const area = document.getElementById('chat-messages');
        let mediaHtml = '';
        
        if (fileUrl) {
            if (fileType && fileType.startsWith('image/')) {
                mediaHtml = `<div class="mt-2"><a href="${fileUrl}" target="_blank"><img src="${fileUrl}" class="max-w-[200px] rounded-lg border"></a></div>`;
            } else {
                mediaHtml = `<div class="mt-2"><a href="${fileUrl}" target="_blank" download class="flex items-center gap-1 bg-black/10 p-2 rounded text-[10px] font-bold text-inherit"><span class="material-symbols-outlined text-xs">download</span> ${fileName || 'Arquivo'}</a></div>`;
            }
        }

        if (type === 'system') {
            area.innerHTML += `<div class="flex justify-center w-full"><div class="bg-blue-50 text-blue-800 text-xs font-bold px-4 py-2 rounded-full border border-blue-100 text-center">${text}</div></div>`;
        } else {
            const isMe = type === 'customer';
            area.innerHTML += `
                <div class="flex ${isMe ? 'justify-end' : 'justify-start'} w-full">
                    <div class="max-w-[85%] p-4 rounded-2xl text-sm font-medium shadow-sm ${isMe ? 'bg-slate-900 text-white rounded-tr-none' : 'bg-white border text-slate-800 rounded-tl-none'}">
                        ${text}${mediaHtml}
                    </div>
                </div>`;
        }
        area.scrollTop = area.scrollHeight;
    },

    renderNPSButtons() {
        const container = document.getElementById('nps-buttons');
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
        } catch (e) { alert("Erro ao salvar avaliação."); }
    }
};

App.init();