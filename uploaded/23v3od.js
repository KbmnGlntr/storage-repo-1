#!/usr/bin/env node

const cors = require('cors');
const path = require('path');
const chalk = require('chalk');
const axios = require('axios');
const express = require('express');
const FileType = require('file-type');
const mime = require('mime-types');
const repoConfig = require('./repos');
const fileTracker = require('./fileTracker');

const app = express();
const port = process.env.PORT || 3000;

app.enable('trust proxy');
app.set('json spaces', 2);

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '20mb' }));

const detectFileTypeInfo = async (fileBuffer, fileName) => {
  if (fileName) {
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const mimeType = mime.lookup(fileName);
    
    if (ext && mimeType) {
      return {
        ext: ext,
        mime: mimeType
      };
    }
  }
  
  const detected = await FileType.fromBuffer(fileBuffer);
  
  if (detected) {
    return {
      ext: detected.ext,
      mime: detected.mime
    };
  }

  return {
    ext: 'unknown',
    mime: 'unknown'
  };
};

async function getRepoSize(owner, repoName, token) {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repoName}`,
      {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    return response.data.size * 1024;
  } catch (error) {
    console.error(chalk.red(`Error getting repo size: ${error.message}`));
    return 0;
  }
}

async function createRepoIfNotExists(owner, repoName, token) {
  try {
    await axios.get(
      `https://api.github.com/repos/${owner}/${repoName}`,
      {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    console.log(chalk.green(`Repository ${repoName} already exists`));
    return true;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      try {
        await axios.post(
          'https://api.github.com/user/repos',
          {
            name: repoName,
            description: 'Auto-created storage repository for file uploads',
            private: true,
            auto_init: true
          },
          
          {
            headers: {
              'Authorization': `token ${token}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          }
        );
        console.log(chalk.green(`Repository ${repoName} created successfully`));
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return true;
      } catch (createError) {
        console.error(chalk.red(`Error creating repository: ${createError.message}`));
        return false;
      }
    }
    return false;
  }
}

async function selectAvailableRepo(fileSize) {
  let activeRepo = repoConfig.getActiveRepo();
  
  if (!activeRepo) {
    throw new Error('No active repository configured');
  }

  await createRepoIfNotExists(activeRepo.owner, activeRepo.name, activeRepo.token);

  const currentSize = await getRepoSize(activeRepo.owner, activeRepo.name, activeRepo.token);
  
  if (currentSize + fileSize > activeRepo.maxSize) {
    console.log(chalk.yellow(`Repository ${activeRepo.name} is full (${(currentSize / 1024 / 1024 / 1024).toFixed(2)}GB). Creating new repo...`));
    
    const nextRepo = repoConfig.switchToNextRepo();
    
    if (!nextRepo) {
      const newRepoId = repoConfig.repos.length + 1;
      const newRepoName = `storage-repo-${newRepoId}`;
      
      console.log(chalk.blue(`Creating new repository: ${newRepoName}`));
      
      const created = await createRepoIfNotExists(activeRepo.owner, newRepoName, activeRepo.token);
      
      if (created) {
        const newRepo = {
          id: newRepoId,
          name: newRepoName,
          owner: activeRepo.owner,
          token: activeRepo.token,
          maxSize: 5 * 1024 * 1024 * 1024,
          currentSize: 0,
          isActive: true
        };
        
        activeRepo.isActive = false;
        
        repoConfig.addNewRepo(newRepo);
        
        return newRepo;
      } else {
        throw new Error('Failed to create new repository');
      }
    }
    
    return nextRepo;
  }
  
  return activeRepo;
}

app.get('/', (req, res) => {
    res.redirect('https://fileups.vercel.app');
});

app.post('/upload', async (req, res) => {
  try {
    const formData = req.body;
    const fileData = formData.file;

    if (!fileData) {
      return res.status(400).json({ 
        status: false,
        error: 'No file uploaded!' 
      });
    }

    const base64Data = fileData.split(',')[1] || fileData;
    const fileBuffer = Buffer.from(base64Data, 'base64');
    const fileSize = fileBuffer.length;

    if (fileSize > 20 * 1024 * 1024) {
      return res.status(400).json({ 
        status: false,
        error: 'File size exceeds 20MB limit!' 
      });
    }

    const targetRepo = await selectAvailableRepo(fileSize);

    const originalFileName = formData.name;
    const randomStr = Math.random().toString(36).substring(2, 8);
    
    let fileExt = '';
    if (originalFileName && originalFileName.includes('.')) {
      fileExt = originalFileName.substring(originalFileName.lastIndexOf('.'));
    } else {
      const fileTypeInfo = await detectFileTypeInfo(fileBuffer, originalFileName);
      fileExt = `.${fileTypeInfo.ext}`;
    }
    
    const fileName = `${randomStr}${fileExt}`;
    const folderName = 'uploaded';
    const filePath = `${folderName}/${fileName}`;

    const githubResponse = await axios.put(
      `https://api.github.com/repos/${targetRepo.owner}/${targetRepo.name}/contents/${filePath}`,
      {
        message: `Upload ${fileName}`,
        content: base64Data,
        branch: 'main'
      },
      {
        headers: {
          'Authorization': `token ${targetRepo.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'okhttp/4.12.0',
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (githubResponse.status !== 201) {
      return res.status(githubResponse.status).json({ 
        status: false,
        message: githubResponse.data
      });
    }

    await fileTracker.addFile({
      fileName: fileName,
      repoId: targetRepo.id,
      repoName: targetRepo.name,
      size: fileSize,
      path: filePath
    });

    const fileUrl = `https://api-fileups.vercel.app/uploaded/${fileName}`;
    const fileSizeFormatted = fileSize < 1024 
      ? `${fileSize} Bytes` 
      : fileSize < 1024 * 1024 
      ? `${(fileSize / 1024).toFixed(2)} KB` 
      : `${(fileSize / (1024 * 1024)).toFixed(2)} MB`;

    const fileTypeInfo = await detectFileTypeInfo(fileBuffer, originalFileName);

    res.status(200).json({
      status: true,
      name: fileName,
      type: fileTypeInfo.mime,
      size: fileSizeFormatted,
      url: fileUrl,
      repository: targetRepo.name
    });

  } catch (error) {
    console.error(chalk.red(`[ ERROR ] Upload: ${error.message}`));
    res.status(500).json({ 
      status: false,
      message: error.message
    });
  }
});

app.get('/uploaded/:fileName', async (req, res) => {
  const fileName = req.params.fileName;
  
  if (!fileName) {
    return res.status(404).json({
      status: false,
      message: 'File not found!'
    });
  }

  try {
    const fileInfo = await fileTracker.findFile(fileName);
    
    if (!fileInfo) {
      return res.status(404).json({
        status: false,
        message: 'File not found in database!'
      });
    }

    const repo = repoConfig.repos.find(r => r.id === fileInfo.repoId);
    
    if (!repo) {
      return res.status(404).json({
        status: false,
        message: 'Repository not found!'
      });
    }

    const response = await axios.get(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/uploaded/${fileName}`,
      {
        headers: {
          'Authorization': `token ${repo.token}`,
          'User-Agent': 'okhttp/4.12.0',
          'Accept': 'application/vnd.github.v3.raw'
        },
        responseType: 'arraybuffer'
      }
    );

    const fileData = response.data;
    const mimeType = mime.lookup(fileName);

    res.set({
      'Content-Type': mimeType,
      'Access-Control-Allow-Origin': '*',
      'Content-Disposition': `inline; filename="${fileName}"`
    });

    res.send(fileData);

  } catch (error) {
    console.error(chalk.red(`[ ERROR ] File fetch: ${error.message}`));
    res.status(404).json({
      status: false,
      message: 'File not found!'
    });
  }
});

app.get('/api/repos/status', async (req, res) => {
  try {
    const allFiles = await fileTracker.getAllFiles();
    
    const repoStatus = await Promise.all(
      repoConfig.repos.map(async (repo) => {
        const size = await getRepoSize(repo.owner, repo.name, repo.token);
        const usedGB = (size / 1024 / 1024 / 1024).toFixed(2);
        const maxGB = (repo.maxSize / 1024 / 1024 / 1024).toFixed(2);
        const percentage = ((size / repo.maxSize) * 100).toFixed(2);
        
        return {
          id: repo.id,
          name: repo.name,
          isActive: repo.isActive,
          used: `${usedGB} GB`,
          max: `${maxGB} GB`,
          percentage: `${percentage}%`,
          fileCount: allFiles.filter(f => f.repoId === repo.id).length
        };
      })
    );

    res.json({
      status: true,
      repositories: repoStatus,
      totalFiles: allFiles.length
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: error.message
    });
  }
});

app.listen(port, () => {
  console.log(chalk.green(`Server running on port: ${port}`));
});

module.exports = app;
