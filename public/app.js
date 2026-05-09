function quizApp() {
  return {
    view: 'quiz',
    loading: false,
    quizWords: [],
    currentIndex: 0,
    currentWord: null,
    revealed: false,
    answered: false,
    isCorrect: false,
    markWrong: false,
    showAdmin: false,
    adminTab: 'add',
    statsTab: 'word',
    newEnglish: '',
    newChinese: '',
    saveMsg: '',
    allWords: [],
    searchQuery: '',
    editingWord: null,
    editEnglish: '',
    editChinese: '',
    editId: null,
    wordStats: [],
    dailyStats: [],
    trendData: [],
    worstWords: [],

    async init() {
      await this.fetchWords();
      await this.startQuiz();
    },

    async startQuiz() {
      this.loading = true;
      this.revealed = false;
      this.answered = false;
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
    },

    reveal() {
      this.revealed = true;
    },

    async markCorrect() {
      this.isCorrect = true;
      this.markWrong = false;
      this.answered = true;
      this.createFallingStars();
      await this.recordAnswer(1);
    },

    async markIncorrect() {
      this.isCorrect = false;
      this.markWrong = true;
      this.answered = true;
      await this.recordAnswer(0);
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
      this.currentIndex++;
      if (this.currentIndex < this.quizWords.length) {
        this.currentWord = this.quizWords[this.currentIndex];
        this.revealed = false;
        this.answered = false;
        this.markWrong = false;
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
