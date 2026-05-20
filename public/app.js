function quizApp() {
  return {
    view: '',
    currentUser: null,
    showUserMenu: false,
    adminTab: 'voice',
    statsTab: 'sm2',

    loginUsername: '',
    loginPassword: '',
    loginError: '',
    loginLoading: false,
    showPassword: false,
    rememberMe: false,

    // Quiz state
    loading: false,
    totalWords: 0,
    quizWords: [],
    quizResults: [],
    currentIndex: 0,
    currentWord: null,
    revealed: false,
    answered: false,
    isCorrect: false,
    markWrong: false,
    correctFlash: false,
    quizComplete: false,
    showNext: false,
    showFeedback: false,
    _quizInitialized: false,
    _showFlyStar: false,
    _flyStarTarget: null,
    _isCorrectAnswer: true,

    // Spell mode (persisted to user_preferences)
    spellMode: false,
    _spellModeLoaded: false,
    hintRevealed: false,
    spellHint: '',

    // Word management
    allWords: [],
    searchQuery: '',
    wordPageSize: 10,
    wordCurrentPage: 1,
    editingWord: null,
    editId: null,
    editEnglish: '',
    editChinese: '',
    newEnglish: '',
    newChinese: '',
    saveMsg: '',

    // Stats
    statsPageSize: 10,
    sm2Page: 1,
    wordStatsPage: 1,
    dailyStatsPage: 1,
    wordStats: [],
    dailyStats: [],
    trendData: [],
    worstWords: [],
    sm2Overview: null,
    sm2WordStates: [],

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
    userWordCounts: {},

    // Voice settings (active, persisted to DB)
    speakGender: 'female',
    speakSpeed: 0.85,
    speakVoiceName: '',
    speakVoices: [],
    currentAudio: null,
    _audioLoading: false,
    _voiceLoaded: false,
    _voiceSettingsLoaded: false,

    // Quiz limit settings (persisted to DB)
    quizLimitMode: 'ratio',
    quizLimitValue: 20,
    pendingQuizLimitMode: 'ratio',
    pendingQuizLimitValue: 20,
    _quizLimitLoaded: false,

    // Pending voice settings (unsaved changes)
    pendingGender: null,
    pendingSpeed: 0.85,
    pendingVoiceName: '',

    // Auth gate: hash changes ignored until /me resolves
    _initCalled: false,
    authReady: false,
    MAX_VISIBLE_STARS: 10,

    // ===== Hash Routing =====

    routeMap: {
      '': { view: 'quiz' },
      '/': { view: 'quiz' },
      '/login': { view: 'login' },
      '/admin': { view: 'admin', adminTab: 'voice' },
      '/admin/voice': { view: 'admin', adminTab: 'voice' },
      '/admin/quizLimit': { view: 'admin', adminTab: 'quizLimit' },
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

    async applyRoute(hash) {
      const route = this.routeMap[hash] || { view: 'quiz' };
      this.view = route.view;
      if (route.adminTab) this.adminTab = route.adminTab;
      if (route.view === 'admin') {
        if (this.adminTab === 'voice') {
          if (!this._voiceLoaded) {
            this._voiceLoaded = true;
            await this.loadVoices();
          }
          this.loadVoiceSettings();
        }
        if (this.adminTab === 'quizLimit') {
          if (!this._quizLimitLoaded) {
            this._quizLimitLoaded = true;
            await this.loadQuizLimitSettings();
          }
        }
        if (this.adminTab === 'words' && this.allWords.length === 0)
          this.fetchWords();
        if (this.adminTab === 'stats') this.setStatsTab(this.statsTab);
        if (this.adminTab === 'users' && this.users.length === 0)
          this.fetchUsers();
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
      this.applyRoute(hash);
    },

    async init() {
      if (this._initCalled) return;
      this._initCalled = true;
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
          await this.loadSpellMode();
          if (!this._voiceLoaded) {
            this._voiceLoaded = true;
            await this.loadVoices();
          }
          await this.loadTotalWords();
          await this.loadTodaySession();
          const hash = this.getRouteHash();
          if (hash === '/login') {
            this.applyRoute('/');
          } else {
            this.applyRoute(hash);
          }
          this.authReady = true;
          return;
        }
      } catch (e) {
        /* not logged in */
      }

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
          body: JSON.stringify({
            username: this.loginUsername,
            password: this.loginPassword,
          }),
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
          if (!this._voiceLoaded) {
            this._voiceLoaded = true;
            await this.loadVoices();
          }
          await this.loadTotalWords();
          await this.loadTodaySession();
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
      } catch (e) {
        /* ignore */
      }
      this.currentUser = null;
      this.showUserMenu = false;
      this.quizWords = [];
      this.quizResults = [];
      this._quizInitialized = false;
      this.allWords = [];
      this._quizLimitLoaded = false;
      this._spellModeLoaded = false;
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

    async loadVoices(gender) {
      try {
        const g = gender || this.speakGender;
        const res = await fetch(`/api/speak/voices?gender=${g}`);
        this.speakVoices = await res.json();
      } catch (e) {
        console.error('Failed to load voices:', e);
      }
    },

    getVoicesForGender(gender) {
      return this.speakVoices.filter((v) => v.gender === gender);
    },

    getSelectedVoice() {
      const voices = this.getVoicesForGender(this.speakGender);
      if (this.speakVoiceName) {
        const found = voices.find((v) => v.name === this.speakVoiceName);
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
      this._quizInitialized = true;
      this.loading = true;
      this.revealed = false;
      this.answered = false;
      this.quizComplete = false;
      this.showNext = false;
      this.showFeedback = false;
      this.hintRevealed = false;
      this.spellHint = '';
      try {
        const res = await fetch('/api/quiz/today');
        const data = await res.json();
        this.quizWords = data.words || [];
        this.quizResults =
          data.results || new Array(this.quizWords.length).fill(null);
        // Restore progress: find first unanswered word
        this.currentIndex = 0;
        for (let i = 0; i < this.quizResults.length; i++) {
          if (this.quizResults[i] === null) {
            this.currentIndex = i;
            break;
          }
          this.currentIndex = i + 1;
        }
        this.currentWord = this.quizWords[this.currentIndex] || null;
        // If all answered, show complete
        if (this.currentIndex >= this.quizWords.length) {
          this.quizComplete = true;
          this.currentWord = this.quizWords[this.quizWords.length - 1] || null;
          this.revealed = true;
        }
      } catch (e) {
        console.error('Failed to load quiz:', e);
      }
      this.loading = false;
    },

    async loadTodaySession() {
      this._quizInitialized = true;
      this.loading = true;
      try {
        const res = await fetch('/api/quiz/session');
        const data = await res.json();
        if (data.exists && data.words.length > 0) {
          this.quizWords = data.words;
          this.quizResults = data.results || [];
          this.currentIndex = 0;
          for (let i = 0; i < this.quizResults.length; i++) {
            if (this.quizResults[i] === null) {
              this.currentIndex = i;
              break;
            }
            this.currentIndex = i + 1;
          }
          this.currentWord = this.quizWords[this.currentIndex] || null;
          if (this.currentIndex >= this.quizWords.length) {
            this.quizComplete = true;
            this.currentWord = this.quizWords[this.quizWords.length - 1] || null;
            this.revealed = true;
          }
        }
      } catch (e) {
        console.error('Failed to load quiz session:', e);
      }
      this.loading = false;
    },

    async retryQuiz() {
      this.loading = true;
      this.quizComplete = false;
      this.revealed = false;
      this.answered = false;
      this.showNext = false;
      this.showFeedback = false;
      this.hintRevealed = false;
      this.spellHint = '';
      try {
        const res = await fetch('/api/quiz/retry', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          this.quizWords = data.words || [];
          this.quizResults = data.results || [];
          this.currentIndex = 0;
          this.currentWord = this.quizWords[0] || null;
        }
      } catch (e) {
        console.error('Failed to retry quiz:', e);
      }
      this.loading = false;
    },

    async restartQuiz() {
      this.loading = true;
      try {
        const res = await fetch('/api/quiz/retry', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          this.quizWords = data.words || [];
          this.quizResults = data.results || [];
          this.currentIndex = 0;
          this.currentWord = this.quizWords[0] || null;
          this.quizComplete = false;
          this.revealed = false;
          this.answered = false;
          this.showNext = false;
          this.showFeedback = false;
          this.hintRevealed = false;
          this.spellHint = '';
        }
      } catch (e) {
        console.error('Failed to restart quiz:', e);
      }
      this.loading = false;
    },

    reveal() {
      this.revealed = true;
      this.markWrong = false;
      this.correctFlash = false;
    },

    async markCorrect() {
      this.isCorrect = true;
      this.markWrong = false;
      this.correctFlash = false;
      this.correctFlash = true;
      this.answered = true;
      this.showNext = false;
      await this.recordAnswer(1);
      // Trigger fly-to-star animation
      this._showFlyStar = true;
      this._isCorrectAnswer = true;
      this._flyStarTarget = null;
      this._computeFlyStarTarget();
      // Update results after animation completes
      setTimeout(() => {
        this.quizResults[this.currentIndex] = 1;
        this._showFlyStar = false;
        this.showNext = true;
      }, 1200);
    },

    _computeFlyStarTarget() {
      this.$nextTick(() => {
        // Find the target star element in the progress bar
        const stars = document.querySelectorAll('.progress-star');
        // Use currentIndex within visible range, or the overflow span
        const visibleIdx = Math.min(this.currentIndex, this.MAX_VISIBLE_STARS - 1);
        const target = stars[visibleIdx];
        if (target) {
          const rect = target.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          this._flyStarTarget = { x: cx, y: cy };
        } else {
          // Fallback: overflow span
          const overflow = document.querySelector('.star-overflow');
          if (overflow) {
            const rect = overflow.getBoundingClientRect();
            this._flyStarTarget = {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            };
          }
        }
      });
    },

    get flyStarStyle() {
      if (!this._flyStarTarget) return '';
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const dx = this._flyStarTarget.x - cx;
      const dy = this._flyStarTarget.y - cy;
      return `--tx: ${dx}px; --ty: ${dy}px;`;
    },

    async markIncorrect() {
      this.isCorrect = false;
      this.markWrong = true;
      this.answered = true;
      this.showNext = false;
      await this.recordAnswer(0);
      // Trigger fly-to-star animation for wrong answer
      this._showFlyStar = true;
      this._isCorrectAnswer = false;
      this._flyStarTarget = null;
      this._computeFlyStarTarget();
      // Update results after animation completes
      setTimeout(() => {
        this.quizResults[this.currentIndex] = 0;
        this._showFlyStar = false;
        this.showNext = true;
      }, 1200);
    },

    async recordAnswer(correct) {
      if (!this.currentWord) return;
      try {
        await fetch('/api/quiz/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            word_id: this.currentWord.id,
            correct,
            spellMode: this.spellMode,
          }),
        });
      } catch (e) {
        console.error('Failed to record:', e);
      }
    },

    nextWord() {
      this.revealed = false;
      this.answered = false;
      this.markWrong = false;
      this.correctFlash = false;
      this.hintRevealed = false;
      this.spellHint = '';
      this.currentIndex++;
      if (this.currentIndex < this.quizWords.length) {
        this.currentWord = this.quizWords[this.currentIndex];
      }
    },

    skipWord() {
      this.quizResults[this.currentIndex] = null;
      if (this.currentIndex >= this.quizWords.length - 1) {
        this.quizComplete = true;
        this.revealed = false;
        this.answered = false;
        this.markWrong = false;
        this.correctFlash = false;
        this.isCorrect = false;
        this.hintRevealed = false;
        this.spellHint = '';
      } else {
        this.nextWord();
      }
    },

    goNext() {
      this.showNext = false;
      this.showFeedback = false;
      this.hintRevealed = false;
      this.spellHint = '';
      if (this.currentIndex >= this.quizWords.length - 1) {
        this.quizComplete = true;
        this.revealed = false;
        this.answered = false;
        this.markWrong = false;
        this.correctFlash = false;
        this.isCorrect = false;
      } else {
        this.nextWord();
      }
    },

    resetQuizState() {
      this.hintRevealed = false;
      this.spellHint = '';
    },

    goToQuizWord(idx) {
      if (idx >= this.currentIndex) return;
      this.currentIndex = idx;
      this.currentWord = this.quizWords[idx];
      this.revealed = true;
      this.answered = true;
      this.showNext = true;
      this.showFeedback = false;
      this.markWrong = this.quizResults[idx] === 0;
      this.correctFlash = this.quizResults[idx] === 1;
      this.hintRevealed = false;
      this.spellHint = '';
    },

    showSpellHint() {
      if (!this.currentWord?.english) return;
      const word = this.currentWord.english;
      this.spellHint = word[0] + '_'.repeat(word.length - 1);
      this.hintRevealed = true;
    },

    async fetchWords() {
      try {
        const res = await fetch('/api/words');
        this.allWords = await res.json();
        this.totalWords = this.allWords.length;
      } catch (e) {
        console.error('Failed to fetch words:', e);
      }
    },

    async loadTotalWords() {
      try {
        const res = await fetch('/api/words');
        const data = await res.json();
        this.totalWords = data.length;
      } catch (e) {
        console.error('Failed to load word count:', e);
      }
    },

    get filteredWords() {
      if (!this.searchQuery) return this.allWords;
      const q = this.searchQuery.toLowerCase();
      return this.allWords.filter(
        (w) => w.english.toLowerCase().includes(q) || w.chinese.includes(q),
      );
    },

    get visibleQuizResults() {
      return this.quizResults.slice(0, this.MAX_VISIBLE_STARS);
    },

    get quizStatsText() {
      const c = this.quizResults.filter((r) => r === 1).length;
      const w = this.quizResults.filter((r) => r === 0).length;
      return `✓${c} ✗${w} / ${this.quizResults.length}`;
    },

    get todayAccuracy() {
      const c = this.quizResults.filter((r) => r === 1).length;
      const t = this.quizResults.filter((r) => r !== null).length;
      if (t === 0) return '0%';
      return Math.round((c / t) * 100) + '%';
    },

    get correctCount() {
      return this.quizResults.filter((r) => r === 1).length;
    },

    get totalAnswered() {
      return this.quizResults.filter((r) => r !== null).length;
    },

    get wordPageWords() {
      const start = (this.wordCurrentPage - 1) * this.wordPageSize;
      return this.filteredWords.slice(start, start + this.wordPageSize);
    },

    get wordTotalPages() {
      return Math.max(
        1,
        Math.ceil(this.filteredWords.length / this.wordPageSize),
      );
    },

    onWordSearchInput() {
      this.wordCurrentPage = 1;
    },

    wordGoToPage(page) {
      if (page < 1 || page > this.wordTotalPages) return;
      this.wordCurrentPage = page;
    },

    get wordPageNumbers() {
      const total = this.wordTotalPages;
      const current = this.wordCurrentPage;
      const pages = [];
      const range = 2;
      const start = Math.max(1, current - range);
      const end = Math.min(total, current + range);
      for (let i = start; i <= end; i++) pages.push(i);
      return pages;
    },

    get wordPageInfo() {
      const total = this.filteredWords.length;
      if (total === 0) return '共 0 条';
      const start = (this.wordCurrentPage - 1) * this.wordPageSize + 1;
      const end = Math.min(this.wordCurrentPage * this.wordPageSize, total);
      return `共 ${total} 条，显示 ${start}-${end}`;
    },

    async addWord() {
      if (!this.newEnglish || !this.newChinese) return;
      try {
        const res = await fetch('/api/words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            english: this.newEnglish,
            chinese: this.newChinese,
          }),
        });
        if (res.ok) {
          this.newEnglish = '';
          this.newChinese = '';
          this.wordCurrentPage = 1;
          this.saveMsg = '✅ 添加成功！';
          setTimeout(() => (this.saveMsg = ''), 2000);
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
          body: JSON.stringify({
            english: this.editEnglish,
            chinese: this.editChinese,
          }),
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
      if (this.allWords.length === 0) {
        await this.fetchWords();
      }
      this.wordStats = [];
      for (const word of this.allWords) {
        try {
          const res = await fetch(`/api/stats/word/${word.id}`);
          const data = await res.json();
          this.wordStats.push(data);
        } catch (e) {
          /* skip */
        }
      }
    },

    async loadDailyStats() {
      try {
        const res = await fetch('/api/stats/daily');
        this.dailyStats = await res.json();
      } catch (e) {
        console.error(e);
      }
    },

    async loadTrendData() {
      try {
        const res = await fetch('/api/stats/trend?period=week');
        this.trendData = await res.json();
      } catch (e) {
        console.error(e);
      }
    },

    async loadWorstWords() {
      try {
        const res = await fetch('/api/stats/worst?limit=10');
        this.worstWords = await res.json();
      } catch (e) {
        console.error(e);
      }
    },

    async loadSm2Stats() {
      try {
        const res = await fetch('/api/stats/sm2');
        this.sm2Overview = await res.json();
      } catch (e) {
        console.error(e);
      }
    },

    async loadSm2WordStates() {
      try {
        const res = await fetch('/api/stats/sm2/words');
        this.sm2WordStates = await res.json();
      } catch (e) {
        console.error(e);
      }
    },

    // --- Stats pagination helpers ---

    _statsPage(data, page) {
      const s = (page - 1) * this.statsPageSize;
      return data.slice(s, s + this.statsPageSize);
    },

    _statsTotalPages(data) {
      return Math.max(1, Math.ceil(data.length / this.statsPageSize));
    },

    _statsPageInfo(data, page) {
      const t = data.length;
      if (t === 0) return '共 0 条';
      const s = (page - 1) * this.statsPageSize + 1;
      const e = Math.min(page * this.statsPageSize, t);
      return `共 ${t} 条，显示 ${s}-${e}`;
    },

    _statsPageNumbers(total, current) {
      const pages = [];
      const range = 2;
      const start = Math.max(1, current - range);
      const end = Math.min(total, current + range);
      for (let i = start; i <= end; i++) pages.push(i);
      return pages;
    },

    get sm2Paged() {
      return this._statsPage(this.sm2WordStates, this.sm2Page);
    },
    get sm2TotalPages() {
      return this._statsTotalPages(this.sm2WordStates);
    },
    get sm2PageInfo() {
      return this._statsPageInfo(this.sm2WordStates, this.sm2Page);
    },
    get sm2PageNums() {
      return this._statsPageNumbers(this.sm2TotalPages, this.sm2Page);
    },
    sm2GoPage(p) {
      if (p >= 1 && p <= this.sm2TotalPages) this.sm2Page = p;
    },

    get wordStatsPaged() {
      return this._statsPage(this.wordStats, this.wordStatsPage);
    },
    get wordStatsTotalPages() {
      return this._statsTotalPages(this.wordStats);
    },
    get wordStatsPageInfo() {
      return this._statsPageInfo(this.wordStats, this.wordStatsPage);
    },
    get wordStatsPageNums() {
      return this._statsPageNumbers(
        this.wordStatsTotalPages,
        this.wordStatsPage,
      );
    },
    wordStatsGoPage(p) {
      if (p >= 1 && p <= this.wordStatsTotalPages) this.wordStatsPage = p;
    },

    get dailyStatsPaged() {
      return this._statsPage(this.dailyStats, this.dailyStatsPage);
    },
    get dailyStatsTotalPages() {
      return this._statsTotalPages(this.dailyStats);
    },
    get dailyStatsPageInfo() {
      return this._statsPageInfo(this.dailyStats, this.dailyStatsPage);
    },
    get dailyStatsPageNums() {
      return this._statsPageNumbers(
        this.dailyStatsTotalPages,
        this.dailyStatsPage,
      );
    },
    dailyStatsGoPage(p) {
      if (p >= 1 && p <= this.dailyStatsTotalPages) this.dailyStatsPage = p;
    },

    getMasteryColor(efactor) {
      if (efactor >= 2.3) return 'good';
      if (efactor >= 1.8) return 'warn';
      return 'bad';
    },

    getStageLabel(repetitions) {
      if (repetitions === 0) return '新词/错误';
      if (repetitions === 1) return '学习中';
      if (repetitions === 2) return '熟悉';
      return '已掌握';
    },

    setStatsTab(tab) {
      this.statsTab = tab;
      if (tab === 'sm2') {
        if (!this.sm2Overview) this.loadSm2Stats();
        if (this.sm2WordStates.length === 0) this.loadSm2WordStates();
      }
      if (tab === 'word') this.loadAllWordStats();
      if (tab === 'daily' && this.dailyStats.length === 0)
        this.loadDailyStats();
      if (tab === 'trend' && this.trendData.length === 0) this.loadTrendData();
      if (tab === 'worst' && this.worstWords.length === 0)
        this.loadWorstWords();
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

    async loadVoiceSettings() {
      if (this._voiceSettingsLoaded) return;
      try {
        const res = await fetch('/api/settings/voice');
        if (res.ok) {
          const data = await res.json();
          this.speakGender = data.gender || 'female';
          this.speakSpeed = parseFloat(data.speed) || 0.85;
          this.speakVoiceName = data.voiceName || '';
        }
      } catch (e) {
        console.error('Failed to load voice settings:', e);
      }
      this.pendingGender = this.speakGender;
      this.pendingSpeed = this.speakSpeed;
      this.pendingVoiceName = this.speakVoiceName;
      this.loadVoices(this.speakGender);
      this._voiceSettingsLoaded = true;
    },

    get voiceSettingsChanged() {
      return (
        this.pendingGender !== this.speakGender ||
        this.pendingSpeed !== this.speakSpeed ||
        this.pendingVoiceName !== this.speakVoiceName
      );
    },

    async saveVoiceSettings() {
      try {
        const res = await fetch('/api/settings/voice', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gender: this.pendingGender,
            voiceName: this.pendingVoiceName,
            speed: this.pendingSpeed,
          }),
        });
        if (res.ok) {
          this.speakGender = this.pendingGender;
          this.speakSpeed = this.pendingSpeed;
          this.speakVoiceName = this.pendingVoiceName;
          await this.loadVoices();
        }
      } catch (e) {
        console.error('Failed to save voice settings:', e);
      }
    },

    // ===== Quiz Limit Settings =====

    async loadQuizLimitSettings() {
      try {
        const res = await fetch('/api/settings/quizLimit');
        if (res.ok) {
          const data = await res.json();
          this.quizLimitMode = data.mode;
          this.quizLimitValue = data.value;
        }
      } catch (e) {
        console.error('Failed to load quiz limit settings:', e);
      }
      this.pendingQuizLimitMode = this.quizLimitMode;
      this.pendingQuizLimitValue = this.quizLimitValue;
    },

    async saveQuizLimitSettings() {
      try {
        const res = await fetch('/api/settings/quizLimit', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: this.pendingQuizLimitMode,
            value: this.pendingQuizLimitValue,
          }),
        });
        if (res.ok) {
          this.quizLimitMode = this.pendingQuizLimitMode;
          this.quizLimitValue = this.pendingQuizLimitValue;
        }
      } catch (e) {
        console.error('Failed to save quiz limit settings:', e);
      }
    },

    setQuizLimitMode(mode) {
      this.pendingQuizLimitMode = mode;
      // Reset to a sensible default when switching modes
      if (mode === 'ratio') this.pendingQuizLimitValue = 20;
      else this.pendingQuizLimitValue = 20;
    },

    setQuizLimitValue(value) {
      this.pendingQuizLimitValue = parseInt(value);
    },

    get quizLimitSettingsChanged() {
      return (
        this.pendingQuizLimitMode !== this.quizLimitMode ||
        this.pendingQuizLimitValue !== this.quizLimitValue
      );
    },
    async playAudio(text, btnSelector) {
      // Prevent duplicate requests while TTS is still loading or playing
      if (this._audioLoading) return;
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio = null;
      }
      const btn = document.querySelector(btnSelector);
      if (btn) btn.classList.add('speaking');
      this._audioLoading = true;

      const voice = this.getSelectedVoice();
      if (!voice) {
        if (btn) btn.classList.remove('speaking');
        this._audioLoading = false;
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
          this._audioLoading = false;
        };
        audio.onerror = () => {
          if (btn) btn.classList.remove('speaking');
          this.currentAudio = null;
          this._audioLoading = false;
        };

        await audio.play();
      } catch (e) {
        console.error('TTS error:', e);
        if (btn) btn.classList.remove('speaking');
        this._audioLoading = false;
      }
    },

    previewSpeak() {
      this.playAudio('Hello, nice to meet you.', '.btn-preview');
    },

    // ===== Spell Mode =====

    async loadSpellMode() {
      try {
        const res = await fetch('/api/settings/spellMode');
        if (res.ok) {
          const data = await res.json();
          this.spellMode = data.spellMode;
        }
      } catch (e) {
        console.error('Failed to load spell mode:', e);
      }
      this._spellModeLoaded = true;
    },

    async toggleSpellMode() {
      this.spellMode = !this.spellMode;
      this.hintRevealed = false;
      this.spellHint = '';
      try {
        await fetch('/api/settings/spellMode', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spellMode: this.spellMode }),
        });
      } catch (e) {
        console.error('Failed to save spell mode:', e);
      }
    },

    // ===== User Management =====

    async fetchUsers() {
      try {
        const res = await fetch('/api/users');
        if (res.ok) {
          this.users = await res.json();
          // Fetch word counts for all users
          for (const u of this.users) {
            try {
              const r = await fetch(`/api/users/${u.id}/words`);
              if (r.ok) {
                const data = await r.json();
                this.userWordCounts[u.id] = data.wordCount;
              }
            } catch (e) {
              /* skip */
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch users:', e);
      }
    },

    async addUser() {
      try {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: this.newUsername,
            password: this.newPassword,
            role: this.newRole,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          this.newUsername = '';
          this.newPassword = '';
          this.userSaveMsg = '创建成功！';
          setTimeout(() => (this.userSaveMsg = ''), 2000);
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
        const body = {
          username: this.editUserUsername,
          role: this.editUserRole,
        };
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
      } catch (e) {
        console.error('Failed to edit user:', e);
      }
    },

    async deleteUser(id) {
      if (!confirm('确定删除？该用户的单词和抽查记录也会被删除。')) return;
      try {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
        if (res.ok) await this.fetchUsers();
      } catch (e) {
        console.error('Failed to delete user:', e);
      }
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
