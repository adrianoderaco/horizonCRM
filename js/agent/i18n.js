export const Translator = {
    currentLang: 'pt',
    cache: {},
    
    dictionary: {
        'pt': {
            'auth-title': 'Acesso Restrito',
            'auth-desc': 'Insira suas credenciais.',
            'lbl-login-hero': 'Painel Operacional<br/><span class="text-blue-500">Realtime</span>',
            'lbl-top-console': 'Console',
            'lbl-btn-settings': 'Configurações Gerais',
            'lbl-title-queue': 'Monitor de Atendimentos',
            'lbl-wait-assign': 'Aguardando Atribuição',
            'lbl-wait-desc': 'O Orquestrador enviará novos chamados automaticamente.\nFique atento às bolhas no cabeçalho.',
            'lbl-title-team': 'Gestão de Equipe & Skills',
            'lbl-title-dash': 'Dashboard & Relatórios',
            'lbl-title-settings': 'Configurações Gerais',
            'queue-count': 'tickets ativos',
            'lbl-th-protocol': 'Protocolo',
            'lbl-th-client': 'Cliente / Assunto',
            'lbl-th-status': 'Status / Tempo',
            'lbl-th-action': 'Ação'
        },
        'en': {
            'auth-title': 'Restricted Access',
            'auth-desc': 'Enter your credentials.',
            'lbl-login-hero': 'Operations Dashboard<br/><span class="text-blue-500">Realtime</span>',
            'lbl-top-console': 'Console',
            'lbl-btn-settings': 'General Settings',
            'lbl-title-queue': 'Ticket Monitor',
            'lbl-wait-assign': 'Waiting for Assignment',
            'lbl-wait-desc': 'The Orchestrator will route new tickets automatically.\nWatch for bubbles in the header.',
            'lbl-title-team': 'Team & Skills Management',
            'lbl-title-dash': 'Dashboard & Reports',
            'lbl-title-settings': 'General Settings',
            'queue-count': 'active tickets',
            'lbl-th-protocol': 'Protocol',
            'lbl-th-client': 'Customer / Subject',
            'lbl-th-status': 'Status / Time',
            'lbl-th-action': 'Action'
        },
        'es': {
            'auth-title': 'Acceso Restringido',
            'auth-desc': 'Ingrese sus credenciales.',
            'lbl-login-hero': 'Panel Operativo<br/><span class="text-blue-500">Realtime</span>',
            'lbl-top-console': 'Consola',
            'lbl-btn-settings': 'Configuración General',
            'lbl-title-queue': 'Monitor de Tickets',
            'lbl-wait-assign': 'Esperando Asignación',
            'lbl-wait-desc': 'El Orquestador enviará nuevos tickets automáticamente.\nEsté atento a las burbujas en el encabezado.',
            'lbl-title-team': 'Gestión de Equipo y Habilidades',
            'lbl-title-dash': 'Panel y Reportes',
            'lbl-title-settings': 'Configuración General',
            'queue-count': 'tickets activos',
            'lbl-th-protocol': 'Protocolo',
            'lbl-th-client': 'Cliente / Asunto',
            'lbl-th-status': 'Estado / Tiempo',
            'lbl-th-action': 'Acción'
        }
    },

    setLanguage(lang) {
        this.currentLang = lang;
        const map = this.dictionary[lang];
        if (!map) return;

        for (const [id, text] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = text;
                else el.innerHTML = text; // Usando innerHTML para aceitar quebras de linha (<br/>)
            }
        }
    },

    async translateDynamic(text) {
        if (!text || text.trim() === '' || this.currentLang === 'pt') return text; 
        
        const cacheKey = `${text}_${this.currentLang}`;
        if (this.cache[cacheKey]) return this.cache[cacheKey];

        try {
            const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${this.currentLang}&dt=t&q=${encodeURIComponent(text)}`);
            const data = await res.json();
            let translated = '';
            data[0].forEach(item => translated += item[0]);
            this.cache[cacheKey] = translated;
            return translated;
        } catch (e) {
            console.error("Erro na tradução automática:", e);
            return text; 
        }
    }
};