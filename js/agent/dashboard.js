// Arquivo: js/agent/dashboard.js
import { supabase } from '../supabase.js';

const Dashboard = {
    async init() {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return window.location.href = 'agente.html';

        await this.renderStats();
        
        // Atualiza os dados a cada 30 segundos automaticamente
        setInterval(() => this.renderStats(), 30000);
    },

    async renderStats() {
        try {
            const { data: tickets } = await supabase.from('tickets').select('status, rating, agent_id');
            const { data: orders } = await supabase.from('orders').select('amount');
            const { data: profiles } = await supabase.from('profiles').select('id, full_name');

            const total = tickets.length;
            const open = tickets.filter(t => t.status === 'open').length;
            const inProgress = tickets.filter(t => t.status === 'in_progress').length;
            const closed = tickets.filter(t => t.status === 'closed').length;
            
            const npsTickets = tickets.filter(t => t.rating !== null);
            const avgNps = npsTickets.length > 0 
                ? (npsTickets.reduce((acc, t) => acc + t.rating, 0) / npsTickets.length).toFixed(1)
                : "0.0";

            const totalSales = orders.reduce((acc, o) => acc + parseFloat(o.amount), 0);

            document.getElementById('stat-total').innerText = total;
            document.getElementById('stat-open').innerText = open;
            document.getElementById('stat-nps').innerText = avgNps;
            document.getElementById('stat-sales').innerText = `R$ ${totalSales.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

            this.updateStatusChart(open, inProgress, closed);
            this.updateAnalystRanking(tickets, profiles);
        } catch (error) {
            console.error("Erro ao carregar dashboard:", error);
        }
    },

    updateStatusChart(open, inProgress, closed) {
        const ctx = document.getElementById('chartStatus').getContext('2d');
        if (window.myChart) window.myChart.destroy();
        
        window.myChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Aguardando (Aberto)', 'Em Atendimento', 'Finalizados'],
                datasets: [{
                    data: [open, inProgress, closed],
                    backgroundColor: ['#3b82f6', '#f59e0b', '#10b981'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: { 
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%', 
                plugins: { 
                    legend: { position: 'bottom', labels: { padding: 20, font: { family: 'Manrope', weight: 'bold' } } } 
                } 
            }
        });
    },

    updateAnalystRanking(tickets, profiles) {
        const container = document.getElementById('analyst-ranking');
        const ranking = profiles.map(p => {
            const agentTickets = tickets.filter(t => t.agent_id === p.id && t.rating !== null);
            const avg = agentTickets.length > 0 
                ? (agentTickets.reduce((acc, t) => acc + t.rating, 0) / agentTickets.length).toFixed(1)
                : 0;
            return { name: p.full_name, avg: parseFloat(avg) };
        }).sort((a, b) => b.avg - a.avg);

        if (ranking.length === 0) {
            container.innerHTML = `<div class="text-sm text-slate-400 font-bold text-center py-4">Nenhum dado disponível.</div>`;
            return;
        }

        container.innerHTML = ranking.map((r, index) => {
            const badgeColor = index === 0 ? 'bg-amber-100 text-amber-600 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200';
            return `
            <div class="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl transition-all hover:bg-slate-100">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${badgeColor} border">${index + 1}º</div>
                    <span class="font-bold text-slate-700">${r.name}</span>
                </div>
                <span class="px-3 py-1 bg-white border rounded-full font-black text-sm ${r.avg > 0 ? 'text-blue-600' : 'text-slate-400'} shadow-sm">${r.avg > 0 ? r.avg.toFixed(1) : '-'}</span>
            </div>
            `;
        }).join('');
    }
};

Dashboard.init();