import { agentAPI } from './api.js';

export const Dashboard = {
    appContext: null, // Recebe referência do App principal

    init(app) {
        this.appContext = app;
    },

    async render() {
        const btnFiltro = document.getElementById('btn-filter-dash');
        let origHtml = '<span class="material-symbols-outlined text-[14px]">filter_alt</span> Filtrar';
        if (btnFiltro) { origHtml = btnFiltro.innerHTML; btnFiltro.innerHTML = `<span class="material-symbols-outlined animate-spin text-[14px]">refresh</span> Buscando...`; }

        try {
            const startDate = document.getElementById('dash-start').value;
            const endDate = document.getElementById('dash-end').value;
            const groupFilter = document.getElementById('dash-filter-group')?.value;

            this.appContext.dashboardTickets = await agentAPI.getDashboardTickets(startDate, endDate); 
            this.appContext.allProfiles = await agentAPI.getTeamProfiles();
            
            const groupSelect = document.getElementById('dash-filter-group');
            if (groupSelect && groupSelect.options.length === 1) {
                const uniqueGroups = [...new Set(this.appContext.allProfiles.map(p => p.team_group).filter(Boolean))];
                uniqueGroups.forEach(g => groupSelect.innerHTML += `<option value="${g}">${g}</option>`);
            }

            let tickets = this.appContext.dashboardTickets;
            if (groupFilter) {
                const groupAgentsIds = this.appContext.allProfiles.filter(p => p.team_group === groupFilter).map(p => p.id);
                tickets = tickets.filter(t => groupAgentsIds.includes(t.agent_id));
            }
            if (this.appContext.dashFilterAgent) {
                tickets = tickets.filter(t => t.agent_id === this.appContext.dashFilterAgent);
            }

            const open = tickets.filter(t => t.status === 'open').length; 
            const inProgress = tickets.filter(t => t.status === 'in_progress').length; 
            const closedTickets = tickets.filter(t => t.status === 'closed');
            const closed = closedTickets.length;
            
            const npsTickets = closedTickets.filter(t => t.rating !== null); 
            const avgNps = npsTickets.length > 0 ? (npsTickets.reduce((acc, t) => acc + t.rating, 0) / npsTickets.length).toFixed(1) : "0.0"; 
            
            let totalWaitMs = 0, waitCount = 0, totalHandleMs = 0, handleCount = 0;

            closedTickets.forEach(t => {
                const created = new Date(t.created_at);
                const closed = new Date(t.closed_at);
                const assigned = t.assigned_at ? new Date(t.assigned_at) : created;

                const waitMs = assigned - created;
                if (waitMs >= 0) { totalWaitMs += waitMs; waitCount++; }
                
                const handleMs = closed - assigned;
                if (handleMs >= 0) { totalHandleMs += handleMs; handleCount++; }
            });

            const formatTime = (ms) => {
                if (ms === 0) return "0m";
                const m = Math.floor(ms / 60000);
                if (m < 60) return `${m}m`;
                const h = Math.floor(m / 60); return `${h}h ${m % 60}m`;
            };

            if (document.getElementById('stat-open')) document.getElementById('stat-open').innerText = open; 
            if (document.getElementById('stat-inprog')) document.getElementById('stat-inprog').innerText = inProgress; 
            if (document.getElementById('stat-closed')) document.getElementById('stat-closed').innerText = closed; 
            if (document.getElementById('stat-tme')) document.getElementById('stat-tme').innerText = formatTime(waitCount > 0 ? totalWaitMs / waitCount : 0); 
            if (document.getElementById('stat-tma')) document.getElementById('stat-tma').innerText = formatTime(handleCount > 0 ? totalHandleMs / handleCount : 0); 
            if (document.getElementById('stat-nps')) document.getElementById('stat-nps').innerText = avgNps; 
            
            this.updateStatusChart(open + inProgress, closed); 
            this.updateAnalystRanking(closedTickets, this.appContext.allProfiles);
            this.renderClosedCasesTable(tickets, this.appContext.allProfiles);
            this.renderChannelStats(closedTickets);

        } catch (error) { console.error("Erro no Dashboard:", error); } finally { if (btnFiltro) btnFiltro.innerHTML = origHtml; }
    },

    renderChannelStats(closedTickets) {
        const container = document.getElementById('channel-stats-container'); if (!container) return;
        const calcMetrics = (arr) => {
            let tma = 0, tme = 0;
            arr.forEach(t => {
                const created = new Date(t.created_at); const closed = new Date(t.closed_at); const assigned = t.assigned_at ? new Date(t.assigned_at) : created;
                tme += (assigned - created); tma += (closed - assigned);
            });
            return { vol: arr.length, tme: arr.length ? Math.floor((tme/arr.length)/60000) : 0, tma: arr.length ? Math.floor((tma/arr.length)/60000) : 0 }
        };

        const wM = calcMetrics(closedTickets.filter(t => t.channel === 'web'));
        const eM = calcMetrics(closedTickets.filter(t => t.channel === 'email'));

        container.innerHTML = `
            <div class="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl"><div class="flex items-center gap-3"><div class="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center"><span class="material-symbols-outlined">forum</span></div><div><div class="font-black text-slate-800">Canal WEB (Chat)</div><div class="text-[10px] font-bold text-slate-500">${wM.vol} casos fechados</div></div></div><div class="text-right text-[10px] font-bold text-slate-500"><div class="mb-1"><span class="text-purple-600">TMA Médio:</span> ${wM.tma}m</div><div><span class="text-orange-600">TME Médio:</span> ${wM.tme}m</div></div></div>
            <div class="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl"><div class="flex items-center gap-3"><div class="w-10 h-10 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center"><span class="material-symbols-outlined">mail</span></div><div><div class="font-black text-slate-800">Canal E-MAIL</div><div class="text-[10px] font-bold text-slate-500">${eM.vol} casos fechados</div></div></div><div class="text-right text-[10px] font-bold text-slate-500"><div class="mb-1"><span class="text-purple-600">TMA Médio:</span> ${eM.tma}m</div><div><span class="text-orange-600">TME Médio:</span> ${eM.tme}m</div></div></div>
        `;
    },

    updateStatusChart(open, closed) {
        const ctx = document.getElementById('chartStatus')?.getContext('2d'); if (!ctx) return;
        if (window.myChart) window.myChart.destroy();
        window.myChart = new Chart(ctx, { type: 'doughnut', data: { labels: ['Em Aberto/Curso', 'Finalizados'], datasets: [{ data: [open, closed], backgroundColor: ['#3b82f6', '#10b981'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'bottom' } } } });
    },

    updateAnalystRanking(closedTickets, profiles) {
        const container = document.getElementById('analyst-ranking'); if (!container) return;
        const groupFilter = document.getElementById('dash-filter-group')?.value;
        let filteredProfiles = profiles; if (groupFilter) filteredProfiles = profiles.filter(p => p.team_group === groupFilter);

        const ranking = filteredProfiles.map(p => { 
            const agentTickets = closedTickets.filter(t => t.agent_id === p.id && t.rating !== null); 
            const avg = agentTickets.length > 0 ? (agentTickets.reduce((acc, t) => acc + t.rating, 0) / agentTickets.length).toFixed(1) : 0; 
            const total = closedTickets.filter(t => t.agent_id === p.id).length;
            return { id: p.id, name: p.full_name, avg: parseFloat(avg), total: total }; 
        }).sort((a, b) => b.total - a.total).filter(r => r.total > 0);
        
        if (ranking.length === 0) { container.innerHTML = `<div class="text-sm text-slate-400 font-bold text-center py-4">Sem dados no período.</div>`; return; }
        
        container.innerHTML = ranking.map((r, i) => { 
            const isSel = this.appContext.dashFilterAgent === r.id;
            return `<div onclick="agentApp.filterDashboardByAgent('${r.id}', '${r.name}')" class="cursor-pointer flex items-center justify-between p-4 bg-slate-50 border ${isSel ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-100'} rounded-2xl transition-all hover:bg-blue-50 relative z-20"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full flex items-center justify-center font-black text-xs bg-slate-100 border">${i + 1}º</div><div><div class="font-bold text-slate-700">${r.name}</div><div class="text-[9px] text-slate-400 font-bold uppercase">${r.total} Casos</div></div></div><span class="px-3 py-1 bg-white border rounded-full font-black text-sm ${r.avg >= 9 ? 'text-green-600' : 'text-slate-400'} shadow-sm">${r.avg > 0 ? r.avg.toFixed(1) : '-'}</span></div>`; 
        }).join('');
    },

    renderClosedCasesTable(tickets, profiles) {
        const container = document.getElementById('closed-cases-tbody'); if (!container) return;
        const closedTickets = tickets.filter(t => t.status === 'closed');
        
        let filteredTickets = closedTickets.filter(t => {
            if (this.appContext.dashFilterAgent && t.agent_id !== this.appContext.dashFilterAgent) return false;
            if (this.appContext.tableSearchQuery) {
                const searchStr = `${t.protocol_number} ${t.customers?.full_name} ${t.agent_tag1} ${t.agent_tag2}`.toLowerCase();
                if (!searchStr.includes(this.appContext.tableSearchQuery)) return false;
            }
            return true;
        });

        if (filteredTickets.length === 0) { container.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 font-medium">Nenhum caso encontrado.</td></tr>`; return; }

        container.innerHTML = filteredTickets.map(t => {
            const agentName = profiles.find(p => p.id === t.agent_id)?.full_name || 'Sistema';
            const created = new Date(t.created_at); const closed = new Date(t.closed_at); const assigned = t.assigned_at ? new Date(t.assigned_at) : created;
            const diffMs = closed - assigned; const hrs = Math.floor(diffMs / 3600000); const mins = Math.floor((diffMs % 3600000) / 60000);
            return `<tr class="hover:bg-slate-50 transition-colors"><td class="p-4 font-black text-slate-900 text-xs">HZ-${t.protocol_number}</td><td class="p-4 text-xs"><div class="font-bold text-slate-800">${t.customers?.full_name || 'Cliente'}</div></td><td class="p-4 text-xs"><div class="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded w-max mb-1 text-[10px]">${t.agent_tag1 || 'Não Tagueado'}</div><div class="font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded w-max text-[10px]">${t.agent_tag2 || ''}</div></td><td class="p-4 font-bold text-slate-700 text-xs">${agentName}</td><td class="p-4 font-bold text-slate-600 text-xs">${hrs > 0 ? hrs+'h ' : ''}${mins}m</td><td class="p-4 text-center text-xs font-black ${t.rating >= 9 ? 'text-green-600' : 'text-slate-300'}">${t.rating || '-'}</td><td class="p-4 text-right"><button onclick="agentApp.viewPastChat('${t.id}', '${t.protocol_number}')" class="bg-slate-100 text-slate-500 p-2 rounded-lg hover:bg-blue-100 hover:text-blue-600 transition-colors"><span class="material-symbols-outlined text-[16px]">visibility</span></button></td></tr>`;
        }).join('');
    }
};