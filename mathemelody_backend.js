// server.js - Main Express Server for Mathemelody Backend

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ============================================
// AUTH ROUTES
// ============================================

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, hashedPassword]
    );

    const user = result.rows[0];

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      token,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Find user
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// COMPOSITION ROUTES
// ============================================

// Create new composition
app.post('/api/compositions', authenticateToken, async (req, res) => {
  try {
    const { title, description, equations, settings, is_public } = req.body;

    if (!title || !equations) {
      return res.status(400).json({ error: 'Title and equations are required' });
    }

    const result = await pool.query(
      `INSERT INTO compositions 
       (user_id, title, description, equations, settings, is_public) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [req.user.id, title, description, JSON.stringify(equations), JSON.stringify(settings), is_public || false]
    );

    res.status(201).json({
      message: 'Composition created successfully',
      composition: result.rows[0],
    });
  } catch (error) {
    console.error('Create composition error:', error);
    res.status(500).json({ error: 'Server error creating composition' });
  }
});

// Get user's compositions
app.get('/api/compositions/my', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, COUNT(DISTINCT l.id) as likes_count, COUNT(DISTINCT cm.id) as comments_count
       FROM compositions c
       LEFT JOIN likes l ON c.id = l.composition_id
       LEFT JOIN comments cm ON c.id = cm.composition_id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );

    res.json({ compositions: result.rows });
  } catch (error) {
    console.error('Get compositions error:', error);
    res.status(500).json({ error: 'Server error fetching compositions' });
  }
});

// Get single composition by ID
app.get('/api/compositions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : null;

    const result = await pool.query(
      `SELECT c.*, u.username,
       COUNT(DISTINCT l.id) as likes_count,
       COUNT(DISTINCT cm.id) as comments_count,
       CASE WHEN $2 IS NOT NULL THEN EXISTS(
         SELECT 1 FROM likes WHERE composition_id = c.id AND user_id = $2
       ) ELSE false END as user_has_liked
       FROM compositions c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN likes l ON c.id = l.composition_id
       LEFT JOIN comments cm ON c.id = cm.composition_id
       WHERE c.id = $1 AND (c.is_public = true OR c.user_id = $2)
       GROUP BY c.id, u.username`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Composition not found or not accessible' });
    }

    // Increment play count
    await pool.query(
      'UPDATE compositions SET play_count = play_count + 1 WHERE id = $1',
      [id]
    );

    res.json({ composition: result.rows[0] });
  } catch (error) {
    console.error('Get composition error:', error);
    res.status(500).json({ error: 'Server error fetching composition' });
  }
});

// Update composition
app.put('/api/compositions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, equations, settings, is_public } = req.body;

    // Check ownership
    const ownership = await pool.query(
      'SELECT user_id FROM compositions WHERE id = $1',
      [id]
    );

    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Composition not found' });
    }

    if (ownership.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to edit this composition' });
    }

    const result = await pool.query(
      `UPDATE compositions 
       SET title = $1, description = $2, equations = $3, settings = $4, is_public = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [title, description, JSON.stringify(equations), JSON.stringify(settings), is_public, id]
    );

    res.json({
      message: 'Composition updated successfully',
      composition: result.rows[0],
    });
  } catch (error) {
    console.error('Update composition error:', error);
    res.status(500).json({ error: 'Server error updating composition' });
  }
});

// Delete composition
app.delete('/api/compositions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check ownership
    const ownership = await pool.query(
      'SELECT user_id FROM compositions WHERE id = $1',
      [id]
    );

    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Composition not found' });
    }

    if (ownership.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this composition' });
    }

    await pool.query('DELETE FROM compositions WHERE id = $1', [id]);

    res.json({ message: 'Composition deleted successfully' });
  } catch (error) {
    console.error('Delete composition error:', error);
    res.status(500).json({ error: 'Server error deleting composition' });
  }
});

// ============================================
// PUBLIC GALLERY ROUTES
// ============================================

// Get public compositions (gallery)
app.get('/api/compositions/public/gallery', async (req, res) => {
  try {
    const { sort = 'recent', limit = 20, offset = 0 } = req.query;

    let orderBy = 'c.created_at DESC';
    if (sort === 'popular') orderBy = 'likes_count DESC, c.created_at DESC';
    if (sort === 'trending') orderBy = 'c.play_count DESC, likes_count DESC';

    const result = await pool.query(
      `SELECT c.id, c.title, c.description, c.created_at, c.play_count, u.username,
       COUNT(DISTINCT l.id) as likes_count,
       COUNT(DISTINCT cm.id) as comments_count
       FROM compositions c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN likes l ON c.id = l.composition_id
       LEFT JOIN comments cm ON c.id = cm.composition_id
       WHERE c.is_public = true
       GROUP BY c.id, u.username
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({ compositions: result.rows });
  } catch (error) {
    console.error('Get gallery error:', error);
    res.status(500).json({ error: 'Server error fetching gallery' });
  }
});

// ============================================
// LIKE ROUTES
// ============================================

// Toggle like on composition
app.post('/api/compositions/:id/like', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if already liked
    const existing = await pool.query(
      'SELECT id FROM likes WHERE composition_id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existing.rows.length > 0) {
      // Unlike
      await pool.query(
        'DELETE FROM likes WHERE composition_id = $1 AND user_id = $2',
        [id, req.user.id]
      );
      res.json({ message: 'Unliked', liked: false });
    } else {
      // Like
      await pool.query(
        'INSERT INTO likes (composition_id, user_id) VALUES ($1, $2)',
        [id, req.user.id]
      );
      res.json({ message: 'Liked', liked: true });
    }
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ error: 'Server error toggling like' });
  }
});

// ============================================
// COMMENT ROUTES
// ============================================

// Add comment
app.post('/api/compositions/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content required' });
    }

    const result = await pool.query(
      `INSERT INTO comments (composition_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, req.user.id, content]
    );

    // Get username
    const userResult = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [req.user.id]
    );

    const comment = {
      ...result.rows[0],
      username: userResult.rows[0].username,
    };

    res.status(201).json({ message: 'Comment added', comment });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Server error adding comment' });
  }
});

// Get comments for composition
app.get('/api/compositions/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.*, u.username
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.composition_id = $1
       ORDER BY c.created_at DESC`,
      [id]
    );

    res.json({ comments: result.rows });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Server error fetching comments' });
  }
});

// Delete comment
app.delete('/api/comments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check ownership
    const ownership = await pool.query(
      'SELECT user_id FROM comments WHERE id = $1',
      [id]
    );

    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (ownership.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    await pool.query('DELETE FROM comments WHERE id = $1', [id]);

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Server error deleting comment' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Mathemelody backend running on port ${PORT}`);
});