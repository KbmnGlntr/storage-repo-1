#!/usr/bin/env node

const GITHUB_TOKEN = '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';

module.exports = {
  repos: [
    {
      id: 1,
      name: 'storage-repo-1',
      owner: 'KbmnGlntr',
      token: GITHUB_TOKEN,
      maxSize: 5 * 1024 * 1024 * 1024,
      currentSize: 0,
      isActive: true
    }
  ],
  
  getActiveRepo() {
    return this.repos.find(repo => repo.isActive);
  },
  
  switchToNextRepo() {
    const currentIndex = this.repos.findIndex(repo => repo.isActive);
    if (currentIndex !== -1 && currentIndex < this.repos.length - 1) {
      this.repos[currentIndex].isActive = false;
      this.repos[currentIndex + 1].isActive = true;
      return this.repos[currentIndex + 1];
    }
    return null;
  },
  
  addNewRepo(newRepo) {
    this.repos.push(newRepo);
  }
};
