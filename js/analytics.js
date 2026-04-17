async function loadAnalytics() {
    // 1. Total de tickets resolvidos hoje
    const { count: resolvedToday } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'resolved')
        .gte('created_at', new Date().toISOString().split('T')[0]);

    // 2. Volume do Backlog (Pendentes)
    const { count: backlog } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

    // Atualiza os cards do seu layout HTML
    document.querySelector('[data-metric="resolved"]').innerText = resolvedToday || 0;
    document.querySelector('[data-metric="backlog"]').innerText = backlog || 0;
    
    // Lista de Agentes Online (da tabela profiles)
    const { data: onlineAgents } = await supabase
        .from('profiles')
        .select('*')
        .eq('status', 'Online');
        
    renderActiveAgents(onlineAgents);
}