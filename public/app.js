function quizApp() {
  return {
    view: 'login',
    currentUser: null,
    showUserMenu: false,
    adminTab: 'voice',
    statsTab: 'word',

    loginUsername: '',
    loginPassword: '',
    loginError: '',
    loginLoading: false,
    showPassword: false,
    rememberMe: false,

    // Quiz state
    loading: false,
    quizWords: [],
    currentIndex: 0,
    currentWord: null,
    revealed: false,
    answered: false,
    isCorrect: false,
    markWrong: false,
    quizComplete: false,
    showNext: false,
    showFeedback: false,
    _quizInitialized: false,

    // Word management
    allWords: [],
    searchQuery: '',
    editingWord: null,
    editId: null,
    editEnglish: '',
    editChinese: '',
    newEnglish: '',
    newChinese: '',
    saveMsg: '',

    // Stats
    wordStats: [],
    dailyStats: [],
    trendData: [],
    worstWords: [],

    // User management
    users: [],
    editingUser: null,
    editUserId: null,
    editUserUsername: '',
    editUserPassword: '',
    editUserRole: '',
    newUsername: '',
    newPassword: '',
    newRole: 'user',
    userSaveMsg: '',

    // Voice settings (active, persisted)
    speakGender: localStorage.getItem('speakGender') || 'female',
    speakSpeed: parseFloat(localStorage.getItem('speakSpeed')) || 0.85,
    speakVoiceName: localStorage.getItem('speakVoiceName') || '',
    speakVoices: [],
    currentAudio: null,

    // Pending voice settings (unsaved changes)
    pendingGender: null,
    pendingSpeed: 0.85,
    pendingVoiceName: '',

    // Auth gate: hash changes ignored until /me resolves
    authReady: false,

    // ===== Hash Routing =====

    routeMap: {
      '': { view: 'quiz' },
      '/': { view: 'quiz' },
      '/login': { view: 'login' },
      '/admin': { view: 'admin', adminTab: 'voice' },
      '/admin/voice': { view: 'admin', adminTab: 'voice' },
      '/admin/words': { view: 'admin', adminTab: 'words' },
      '/admin/stats': { view: 'admin', adminTab: 'stats' },
      '/admin/users': { view: 'admin', adminTab: 'users' },
    },

    getRouteHash() {
      const hash = location.hash.slice(1);
      if (this.routeMap[hash]) return hash;
      if (hash.startsWith('/admin')) return '/admin';
      return '/';
    },

    applyRoute(hash) {
      const route = this.routeMap[hash] || { view: 'quiz' };
      this.view = route.view;
      if (route.adminTab) this.adminTab = route.adminTab;
      // Load data for the target view (deduplicated)
      if (route.view === 'quiz' && this.currentUser && !this._quizInitialized) {
        this.startQuiz();
      }
      if (route.view === 'admin') {
        if (this.adminTab === 'voice' && this.speakVoices.length === 0) this.loadVoices();
        if (this.adminTab === 'words' && this.allWords.length === 0) this.fetchWords();
        if (this.adminTab === 'stats') this.setStatsTab(this.statsTab);
        if (this.adminTab === 'users' && this.users.length === 0) this.fetchUsers();
      }
      // Update URL without triggering hashchange
      const target = hash.startsWith('#') ? hash : '#' + hash;
      if (location.hash !== target) {
        history.replaceState(null, '', target);
      }
    },

    handleHashChange() {
      if (!this.authReady) return;
      const hash = this.getRouteHash();
      if (this.currentUser || hash === '/login') {
        this.applyRoute(hash);
      }
    },

    navigate(hash) {
      const target = hash.startsWith('#') ? hash : '#' + hash;
      if (location.hash !== target) {
        history.pushState(null, '', target);
      }
      this.handleHashChange();
    },

    async init() {
      // Restore remembered credentials
      const saved = localStorage.getItem('loginUsername');
      if (saved) {
        this.loginUsername = saved;
        this.loginPassword = localStorage.getItem('loginPassword') || '';
        this.rememberMe = true;
      }

      window.addEventListener('hashchange', () => this.handleHashChange());

      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          this.currentUser = data.user;
          await this.startQuiz();
          const hash = this.getRouteHash();
          if (hash === '/login') {
            this.applyRoute('/');
          } else {
            this.applyRoute(hash);
          }
          this.authReady = true;
          return;
        }
      } catch (e) { /* not logged in */ }

      // Not logged in — show login or handle redirect
      const hash = this.getRouteHash();
      if (hash === '/login' || hash === '/' || hash === '') {
        this.applyRoute('/login');
      } else {
        // Redirect to login but preserve original hash
        this.applyRoute('/login');
      }
      this.authReady = true;
    },

    async login() {
      this.loginLoading = true;
      this.loginError = '';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: this.loginUsername, password: this.loginPassword }),
        });
        const data = await res.json();
        if (res.ok) {
          if (this.rememberMe) {
            localStorage.setItem('loginUsername', this.loginUsername);
            localStorage.setItem('loginPassword', this.loginPassword);
          } else {
            localStorage.removeItem('loginUsername');
            localStorage.removeItem('loginPassword');
          }
          this.currentUser = data.user;
          this.loginUsername = '';
          this.loginPassword = '';
          await this.startQuiz();
          this.navigate('/');
        } else {
          this.loginError = data.error || '登录失败';
        }
      } catch (e) {
        this.loginError = '网络错误';
      }
      this.loginLoading = false;
    },

    async logout() {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) { /* ignore */ }
      this.currentUser = null;
      this.showUserMenu = false;
      this.quizWords = [];
      this._quizInitialized = false;
      this.allWords = [];
      // Restore remembered credentials
      const saved = localStorage.getItem('loginUsername');
      if (saved) {
        this.loginUsername = saved;
        this.loginPassword = localStorage.getItem('loginPassword') || '';
        this.rememberMe = true;
      } else {
        this.loginUsername = '';
        this.loginPassword = '';
        this.rememberMe = false;
      }
      this.navigate('/login');
    },

    async loadVoices() {
      try {
        const res = await fetch(`/api/speak/voices?gender=${this.speakGender}`);
        this.speakVoices = await res.json();
      } catch (e) {
        console.error('Failed to load voices:', e);
      }
    },

    getVoicesForGender(gender) {
      return this.speakVoices.filter(v => v.gender === gender);
    },

    getSelectedVoice() {
      const voices = this.getVoicesForGender(this.speakGender);
      if (this.speakVoiceName) {
        const found = voices.find(v => v.name === this.speakVoiceName);
        if (found) return found;
      }
      return voices.length > 0 ? voices[0] : null;
    },

    getVoicesList() {
      const gender = this.pendingGender || this.speakGender;
      return this.getVoicesForGender(gender);
    },

    async speakWord() {
      if (!this.currentWord?.english) return;
      await this.playAudio(this.currentWord.english, '.btn-speak');
    },

    async startQuiz() {
      this.loading = true;
      this.revealed = false;
      this.answered = false;
      this.quizComplete = false;
      this.showNext = false;
      this.showFeedback = false;
      try {
        const res = await fetch('/api/quiz/today');
        const data = await res.json();
        this.quizWords = data.words || [];
        this.currentIndex = 0;
        this.currentWord = this.quizWords[0] || null;
      } catch (e) {
        console.error('Failed to load quiz:', e);
      }
      this.loading = false;
      this._quizInitialized = true;
    },

    reveal() {
      this.revealed = true;
    },

    async markCorrect() {
      this.isCorrect = true;
      this.markWrong = false;
      this.answered = true;
      this.showFeedback = true;
      this.showNext = false;
      this.createFallingStars();
      await this.recordAnswer(1);
      setTimeout(() => {
        this.showFeedback = false;
        this.showNext = true;
      }, 3000);
    },

    async markIncorrect() {
      this.isCorrect = false;
      this.markWrong = true;
      this.answered = true;
      this.showFeedback = true;
      this.showNext = false;
      await this.recordAnswer(0);
      setTimeout(() => {
        this.showFeedback = false;
        this.showNext = true;
      }, 3000);
    },

    async recordAnswer(correct) {
      if (!this.currentWord) return;
      try {
        await fetch('/api/quiz/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word_id: this.currentWord.id, correct }),
        });
      } catch (e) {
        console.error('Failed to record:', e);
      }
    },

    nextWord() {
      this.revealed = false;
      this.answered = false;
      this.markWrong = false;
      this.currentIndex++;
      if (this.currentIndex < this.quizWords.length) {
        this.currentWord = this.quizWords[this.currentIndex];
      }
    },

    skipWord() {
      if (this.currentIndex >= this.quizWords.length - 1) {
        this.quizComplete = true;
        this.revealed = false;
        this.answered = false;
        this.markWrong = false;
        this.isCorrect = false;
      } else {
        this.nextWord();
      }
    },

    goNext() {
      this.showNext = false;
      this.showFeedback = false;
      if (this.currentIndex >= this.quizWords.length - 1) {
        this.quizComplete = true;
        this.revealed = false;
        this.answered = false;
        this.markWrong = false;
        this.isCorrect = false;
      } else {
        this.nextWord();
      }
    },

    async fetchWords() {
      try {
        const res = await fetch('/api/words');
        this.allWords = await res.json();
      } catch (e) {
        console.error('Failed to fetch words:', e);
      }
    },

    get filteredWords() {
      if (!this.searchQuery) return this.allWords;
      const q = this.searchQuery.toLowerCase();
      return this.allWords.filter(w =>
        w.english.toLowerCase().includes(q) || w.chinese.includes(q)
      );
    },

    async addWord() {
      if (!this.newEnglish || !this.newChinese) return;
      try {
        const res = await fetch('/api/words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ english: this.newEnglish, chinese: this.newChinese }),
        });
        if (res.ok) {
          this.newEnglish = '';
          this.newChinese = '';
          this.saveMsg = '✅ 添加成功！';
          setTimeout(() => this.saveMsg = '', 2000);
          await this.fetchWords();
        } else {
          const data = await res.json();
          this.saveMsg = `❌ ${data.error}`;
        }
      } catch (e) {
        this.saveMsg = '❌ 添加失败';
      }
    },

    editWord(word) {
      this.editingWord = true;
      this.editId = word.id;
      this.editEnglish = word.english;
      this.editChinese = word.chinese;
    },

    async saveEdit() {
      try {
        const res = await fetch(`/api/words/${this.editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ english: this.editEnglish, chinese: this.editChinese }),
        });
        if (res.ok) {
          this.editingWord = null;
          await this.fetchWords();
        }
      } catch (e) {
        console.error('Failed to edit:', e);
      }
    },

    async deleteWord(id) {
      if (!confirm('确定删除？')) return;
      try {
        await fetch(`/api/words/${id}`, { method: 'DELETE' });
        await this.fetchWords();
      } catch (e) {
        console.error('Failed to delete:', e);
      }
    },

    async loadAllWordStats() {
      this.wordStats = [];
      for (const word of this.allWords) {
        try {
          const res = await fetch(`/api/stats/word/${word.id}`);
          const data = await res.json();
          this.wordStats.push(data);
        } catch (e) { /* skip */ }
      }
    },

    async loadDailyStats() {
      try {
        const res = await fetch('/api/stats/daily');
        this.dailyStats = await res.json();
      } catch (e) { console.error(e); }
    },

    async loadTrendData() {
      try {
        const res = await fetch('/api/stats/trend?period=week');
        this.trendData = await res.json();
      } catch (e) { console.error(e); }
    },

    async loadWorstWords() {
      try {
        const res = await fetch('/api/stats/worst?limit=10');
        this.worstWords = await res.json();
      } catch (e) { console.error(e); }
    },

    setStatsTab(tab) {
      this.statsTab = tab;
      if (tab === 'word') this.loadAllWordStats();
      if (tab === 'daily' && this.dailyStats.length === 0) this.loadDailyStats();
      if (tab === 'trend' && this.trendData.length === 0) this.loadTrendData();
      if (tab === 'worst' && this.worstWords.length === 0) this.loadWorstWords();
    },

    createFallingStars() {
      const container = document.getElementById('stars');
      for (let i = 0; i < 12; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = '-10px';
        star.style.width = (Math.random() * 4 + 2) + 'px';
        star.style.height = star.style.width;
        star.style.animation = `fall ${Math.random() * 2 + 1.5}s linear forwards`;
        star.style.animationDelay = Math.random() * 0.5 + 's';
        container.appendChild(star);
        setTimeout(() => star.remove(), 3000);
      }
    },

    async setSpeakGender(g) {
      this.pendingGender = g;
      await this.loadVoices(g);
    },
    setSpeakVoice(name) {
      this.pendingVoiceName = name;
    },
    setSpeakSpeed(s) {
      this.pendingSpeed = parseFloat(s);
    },

    loadVoiceSettings() {
      this.pendingGender = this.speakGender;
      this.pendingSpeed = this.speakSpeed;
      this.pendingVoiceName = this.speakVoiceName;
      this.loadVoices(this.speakGender);
    },

    get voiceSettingsChanged() {
      return this.pendingGender !== this.speakGender
        || this.pendingSpeed !== this.speakSpeed
        || this.pendingVoiceName !== this.speakVoiceName;
    },

    async saveVoiceSettings() {
      this.speakGender = this.pendingGender;
      this.speakSpeed = this.pendingSpeed;
      this.speakVoiceName = this.pendingVoiceName;
      localStorage.setItem('speakGender', this.speakGender);
      localStorage.setItem('speakSpeed', this.speakSpeed);
      localStorage.setItem('speakVoiceName', this.speakVoiceName);
      await this.loadVoices();
    },
    async playAudio(text, btnSelector) {
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio = null;
      }
      const btn = document.querySelector(btnSelector);
      if (btn) btn.classList.add('speaking');

      const voice = this.getSelectedVoice();
      if (!voice) {
        if (btn) btn.classList.remove('speaking');
        return;
      }

      try {
        const res = await fetch('/api/speak/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice: voice.name,
            speed: this.speakSpeed,
          }),
        });

        if (!res.ok) throw new Error('Failed to generate speech');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.currentAudio = audio;

        audio.onended = () => {
          if (btn) btn.classList.remove('speaking');
          this.currentAudio = null;
        };
        audio.onerror = () => {
          if (btn) btn.classList.remove('speaking');
          this.currentAudio = null;
        };

        await audio.play();
      } catch (e) {
        console.error('TTS error:', e);
        if (btn) btn.classList.remove('speaking');
      }
    },

    previewSpeak() {
      this.playAudio('Hello, nice to meet you.', '.btn-preview');
    },

    // ===== User Management =====

    async fetchUsers() {
      try {
        const res = await fetch('/api/users');
        if (res.ok) this.users = await res.json();
      } catch (e) { console.error('Failed to fetch users:', e); }
    },

    async addUser() {
      try {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: this.newUsername, password: this.newPassword, role: this.newRole }),
        });
        const data = await res.json();
        if (res.ok) {
          this.newUsername = '';
          this.newPassword = '';
          this.userSaveMsg = '创建成功！';
          setTimeout(() => this.userSaveMsg = '', 2000);
          await this.fetchUsers();
        } else {
          this.userSaveMsg = data.error || '创建失败';
        }
      } catch (e) {
        this.userSaveMsg = '创建失败';
      }
    },

    editUser(user) {
      this.editingUser = true;
      this.editUserId = user.id;
      this.editUserUsername = user.username;
      this.editUserPassword = '';
      this.editUserRole = user.role;
    },

    async saveEditUser() {
      try {
        const body = { username: this.editUserUsername, role: this.editUserRole };
        if (this.editUserPassword) body.password = this.editUserPassword;
        const res = await fetch(`/api/users/${this.editUserId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          this.editingUser = null;
          await this.fetchUsers();
        }
      } catch (e) { console.error('Failed to edit user:', e); }
    },

    async deleteUser(id) {
      if (!confirm('确定删除？该用户的单词和抽查记录也会被删除。')) return;
      try {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
        if (res.ok) await this.fetchUsers();
      } catch (e) { console.error('Failed to delete user:', e); }
    },
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('stars');
  for (let i = 0; i < 50; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = Math.random() * 3 + 's';
    container.appendChild(star);
  }
});
