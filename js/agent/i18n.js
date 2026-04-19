export const Translator = {
    currentLang: 'pt',
    cache: {},
    
    // Dicionário Estático da Interface (Adicione os IDs dos elementos HTML e a tradução)
    dictionary: {
        'pt': {
            'auth-title': 'Acesso Restrito',
            'auth-desc': 'Insira suas credenciais.',
            'queue-count': 'tickets ativos',
            'chat-header-name': 'Cliente',
            // Você pode adicionar mais IDs da tela aqui futuramente
        },
        'en': {
            'auth-title': 'Restricted Access',
            'auth-desc': 'Enter your credentials.',
            'queue-count': 'active tickets',
            'chat-header-name': 'Customer',
        },
        'es': {
            'auth-title': 'Acceso Restringido',
            'auth-desc': 'Ingrese sus credenciales.',
            'queue-count': 'tickets activos',
            'chat-header-name': 'Cliente',
        }
    },

    setLanguage(lang) {
        this.currentLang = lang;
        const map = this.dictionary[lang];
        if (!map) return;

        // Traduz a Interface Estática
        for (const [id, text] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (el) {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = text;
                else el.innerText = text;
            }
        }
    },

    // Tradutor Dinâmico via Google Translate API (Gratuita)
    async translateDynamic(text) {
        if (!text || text.trim() === '' || this.currentLang === 'pt') return text; // Se for PT, não gasta requisição
        
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
            return text; // Se falhar, retorna o texto original
        }
    }
};