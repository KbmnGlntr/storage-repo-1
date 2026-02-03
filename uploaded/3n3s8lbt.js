#!/usr/bin/env node

const axios = require('axios');

const GIST_ID = '37366507ecf94b7819421ebebf4dad12';
const GITHUB_TOKEN = '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';

class FileTracker {
  constructor() {
    this.files = [];
  }

  async loadDatabase() {
    try {
      const response = await axios.get(
        `https://api.github.com/gists/${GIST_ID}`,
        {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );
      
      const content = response.data.files['files.json'].content;
      this.files = JSON.parse(content);
      return this.files;
    } catch (error) {
      this.files = [];
      return [];
    }
  }

  async saveDatabase() {
    try {
      await axios.patch(
        `https://api.github.com/gists/${GIST_ID}`,
        {
          files: {
            'files.json': {
              content: JSON.stringify(this.files, null, 2)
            }
          }
        },
        {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );
    } catch (error) {
      console.error('Error saving database:', error.message);
    }
  }

  async addFile(fileData) {
    await this.loadDatabase();
    this.files.push({
      fileName: fileData.fileName,
      repoId: fileData.repoId,
      repoName: fileData.repoName,
      size: fileData.size,
      path: fileData.path,
      uploadDate: new Date().toISOString()
    });
    
    await this.saveDatabase();
  }

  async findFile(fileName) {
    await this.loadDatabase();
    return this.files.find(f => f.fileName === fileName);
  }

  async getRepoCurrentSize(repoId) {
    await this.loadDatabase();
    
    return this.files
      .filter(f => f.repoId === repoId)
      .reduce((total, f) => total + f.size, 0);
  }

  async getAllFiles() {
    await this.loadDatabase();
    return this.files;
  }
}

module.exports = new FileTracker();
