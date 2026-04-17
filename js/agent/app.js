// Arquivo: js/agent/app.js
import { agentAPI } from './api.js';
import { supabase } from '../supabase.js';

const App = {
    activeTicketId: null,
    messageSub: null,
    isRegisterMode: false,
    currentUser: null,
    allSubjects: [],

    init() {
        window.agentApp = this; 

        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin">refresh</span> Aguarde...`;
            
            const email = document.getElementById('login-email').value;
            const pass = document.getElementById('login-pass').value;

            if (this.isRegisterMode) {
                const name = document.getElementById('reg-name').value;
                try {
                    await agentAPI.register(name, email, pass);
                    alert("Cadastro realizado com sucesso! Aguarde a aprovação do gestor para fazer login.");
                    this.toggleAuthMode();
                } catch (err) { 
                    alert("Erro ao cadastrar: " + err.message); 
                } finally {
                    btn.innerHTML = originalText;
                }
                return;
            }

            try {
                const authData = await agentAPI.login(email, pass);
                const { data: profile } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();
                
                if (!profile || !profile.is_approved) {
                    alert("Seu acesso ainda está pendente de aprovação pelo gestor.");
                    await supabase.auth.signOut();
                    btn.innerHTML = originalText;
                    return;
                }

                this.currentUser = profile;
                document.getElementById('view-login').classList.add('hidden-view');
                document.getElementById('view-app').classList.remove('hidden-view');
                
                if (profile.role === 'gestor') {
                    document.getElementById('menu-team').classList.remove('hidden-view');
                    this.allSubjects = await agentAPI.getAllSubjects();
                }
                
                document.getElementById('toggle-routing').checked = profile.is_routing_active;
                this.loadQueue();
                agentAPI.subscribeToQueue(() => this.loadQueue());

            } catch (error) { 
                alert("Erro no login. Verifique as credenciais."); 
                btn.innerHTML = originalText;
            }
        });

        document.getElementById('agent-chat-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if(!text || !this.activeTicketId) return;
            
            this.renderMsg(text, 'agent');
            input.value = '';
            await agentAPI.sendMessage(this.activeTicketId, text);
        });
    },

    toggleAuthMode() {
        this.isRegisterMode = !this.isRegisterMode;
        document.getElementById('auth-title').innerText = this.isRegisterMode ? "Solicitar Acesso" : "Acesso Restrito";
        document.getElementById('auth-desc').innerText = this.isRegisterMode ? "Crie sua conta para aprovação do gestor." : "Insira suas credenciais para acessar a fila.";
        document.getElementById('btn-login').innerHTML = this.isRegisterMode ? 'Criar Conta' : 'Entrar <span class="material-symbols-outlined">login</span>';
        document.getElementById('btn-toggle-auth').innerText = this.isRegisterMode ? "Já tem conta? Fazer Login" : "Não tem conta? Solicitar Acesso";
        
        const regName = document.getElementById('reg-name');
        if (this.isRegisterMode) {
            regName.classList.remove('hidden-view');
            regName.required = true;
        } else {
            regName.classList.add('hidden-view');
            regName.required = false;
        }
    },

    navigate(target) {
        ['queue', 'chat', 'team'].forEach(s => {
            const el = document.getElementById(`sec-${s}`);
            if(el) el.classList.add('hidden-view');
        });
        document.getElementById(`sec-${target}`).classList.remove('hidden-view');
        
        if(target === 'team') this.loadTeam();
    },

    async toggleRouting(isActive) {
        try {
            await agentAPI.updateRoutingStatus(this.currentUser.id, isActive);
        } catch(e) {
            alert("Erro ao alterar status do orquestrador.");
        }
    },

    async loadQueue() {
        const tickets = await agentAPI.getPendingTickets();
        const tbody = document.getElementById('queue-tbody');
        const countEl = document.getElementById('queue-count');
        if(countEl) countEl.innerText = `${tickets.length} tickets`;

        if (tickets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center font-bold text-slate-300">Nenhum ticket pendente.</td></tr>`;
            return;
        }

        tbody.innerHTML = tickets.map(t => `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-5 font-black text-slate-900">HZ-${t.protocol_number} <span class="text-[10px] font-bold uppercase bg-slate-200 text-slate-600 px-2 py-0.5 rounded ml-2">${t.channel}</span></td>
                <td class="p-5 font-black text-slate-900">${t.customers.full_name} <br><span class="text-[11px] text-slate-400 font-bold">${t.customers.email}</span></td>
                <td class="p-5 font-bold text-sm text-slate-600">${t.ticket_subjects ? t.ticket_subjects.label : '---'}</td>
                <td class="p-5 text-right">
                    <button onclick="agentApp.pickTicket('${t.id}')" class="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-xs font-black hover:bg-blue-600 transition-all">Atender</button>
                </td>
            </tr>
        `).join('');
    },

    async pickTicket(id) {
        this.activeTicketId = id;
        this.navigate('chat');
        document.getElementById('menu-chat').classList.remove('hidden-view');
        document.getElementById('chat-history').innerHTML = '';

        const t = await agentAPI.getTicketDetails(id);
        
        document.getElementById('chat-header-name').innerText = t.customers.full_name;
        document.getElementById('chat-header-protocol').innerText = `HZ-${t.protocol_number}`;
        document.getElementById('crm-name').innerText = t.customers.full_name;
        document.getElementById('crm-email').innerText = t.customers.email;
        document.getElementById('crm-tag1').innerText = t.ticket_subjects ? t.ticket_subjects.label : 'Sem assunto';
        document.getElementById('crm-tag2').value = t.tag2_detail || '';

        const msgs = await agentAPI.getMessages(id);
        msgs.forEach(m => this.renderMsg(m.content, m.sender_type));

        if (this.messageSub) this.messageSub.unsubscribe();
        this.messageSub = agentAPI.subscribeToMessages(id, (msg) => this.renderMsg(msg, 'customer'));
    },

    renderMsg(text, type) {
        const isAgent = type === 'agent';
        const area = document.getElementById('chat-history');
        area.innerHTML += `
            <div class="flex ${isAgent ? 'justify-end' : 'justify-start'} w-full">
                <div class="max-w-[80%] p-4 rounded-2xl text-sm font-medium shadow-sm ${isAgent ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border border-slate-100'}">
                    ${text}
                </div>
            </div>
        `;
        area.scrollTop = area.scrollHeight;
    },

    async closeTicket() {
        if (!confirm("Tem certeza que deseja finalizar este atendimento?")) return;
        const tag2 = document.getElementById('crm-tag2').value.trim();
        try {
            await agentAPI.closeTicket(this.activeTicketId, tag2);
            alert("Atendimento finalizado com sucesso!");
            this.activeTicketId = null;
            document.getElementById('menu-chat').classList.add('hidden-view');
            this.navigate('queue');
        } catch (error) {
            alert("Erro ao fechar o ticket.");
        }
    },

    // ------------------------------------
    // LÓGICA DA EQUIPE (GESTOR)
    // ------------------------------------
    async loadTeam() {
        const team = await agentAPI.getTeamProfiles();
        const tbody = document.getElementById('team-tbody');
        
        tbody.innerHTML = team.map(member => {
            const isApproved = member.is_approved ? '<span class="text-green-600 font-bold">Aprovado</span>' : '<span class="text-amber-600 font-bold">Pendente</span>';
            
            // Monta as caixinhas de Skills dinamicamente para os aprovados
            let skillsHTML = '';
            if (member.is_approved) {
                skillsHTML = `<div class="flex flex-col gap-2">`;
                this.allSubjects.forEach(sub => {
                    const hasSkill = member.agent_skills.some(skill => skill.subject_id === sub.id);
                    skillsHTML += `
                        <label class="flex items-center gap-2 cursor-pointer w-fit">
                            <input type="checkbox" 
                                   ${hasSkill ? 'checked' : ''} 
                                   onchange="agentApp.toggleSkill('${member.id}', '${sub.id}', this.checked)"
                                   class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer">
                            <span class="text-[11px] font-bold text-slate-600">${sub.label}</span>
                        </label>
                    `;
                });
                skillsHTML += `</div>`;
            } else {
                skillsHTML = '<span class="text-xs text-slate-400">Aprove o acesso para configurar.</span>';
            }
            
            return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-5 font-black text-slate-900">${member.full_name}<br><span class="text-[11px] font-bold text-slate-400">${member.email}</span></td>
                <td class="p-5 text-sm">${isApproved} <br><span class="uppercase text-[10px] font-bold text-slate-500">${member.role}</span></td>
                <td class="p-5">${skillsHTML}</td>
                <td class="p-5 text-right align-top">
                    ${!member.is_approved ? `<button onclick="agentApp.approveMember('${member.id}')" class="bg-blue-600 text-white px-4 py-2 rounded font-bold text-xs">Aprovar</button>` : ''}
                </td>
            </tr>`;
        }).join('');
    },

    async approveMember(id) {
        if(confirm("Deseja aprovar o acesso deste analista?")) {
            await agentAPI.approveUser(id, 'analista');
            this.loadTeam();
        }
    },

    async toggleSkill(agentId, subjectId, isAdding) {
        try {
            await agentAPI.toggleAgentSkill(agentId, subjectId, isAdding);
        } catch (error) {
            alert("Erro ao salvar a especialidade.");
            this.loadTeam(); // Recarrega a tabela para reverter o checkbox em caso de erro
        }
    }
};

App.init();