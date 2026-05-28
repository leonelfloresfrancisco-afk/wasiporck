const express = require('express');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cloudinary config (se configurará con variables de Railway)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// MySQL connection pool
let pool;

const storage = multer.memoryStorage();
const upload = multer({ storage });

// ============ VERIFY TOKEN ============
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// ============ INIT DATABASE ============
async function initDB() {
  try {
    pool = await mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10
    });
    
    console.log('✅ Conectado a MySQL');
    
    const connection = await pool.getConnection();
    
    // Tabla admins
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT PRIMARY KEY AUTO_INCREMENT,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Tabla productos
    await connection.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id INT PRIMARY KEY AUTO_INCREMENT,
        tipo ENUM('cerdo', 'alimento', 'accesorio', 'seminal') NOT NULL,
        imagen VARCHAR(500),
        nombre VARCHAR(100),
        genero VARCHAR(20),
        edad VARCHAR(50),
        etapa VARCHAR(50),
        descripcion TEXT,
        precio DECIMAL(10,2) NOT NULL,
        stock INT DEFAULT 0,
        disponible BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Tabla pedidos
    await connection.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id INT PRIMARY KEY AUTO_INCREMENT,
        nombre VARCHAR(100) NOT NULL,
        telefono VARCHAR(20) NOT NULL,
        direccion TEXT NOT NULL,
        total DECIMAL(10,2) NOT NULL,
        productos TEXT NOT NULL,
        estado VARCHAR(50) DEFAULT 'pendiente',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Tabla carousel
    await connection.query(`
      CREATE TABLE IF NOT EXISTS carousel (
        id INT PRIMARY KEY AUTO_INCREMENT,
        imagen VARCHAR(500) NOT NULL,
        titulo VARCHAR(200),
        activo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Tabla popup_bienvenida
    await connection.query(`
      CREATE TABLE IF NOT EXISTS popup_bienvenida (
        id INT PRIMARY KEY AUTO_INCREMENT,
        imagen VARCHAR(500),
        texto TEXT,
        boton_texto VARCHAR(100),
        boton_whatsapp VARCHAR(20),
        activo BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // Insertar admin por defecto
    const [admins] = await connection.query('SELECT * FROM admins WHERE email = "admin@wasiporck.com"');
    if (admins.length === 0) {
      const hashedPass = await bcrypt.hash('WasiPorck2025!', 10);
      await connection.query('INSERT INTO admins (email, password) VALUES (?, ?)', ['admin@wasiporck.com', hashedPass]);
      console.log('✅ Admin creado: admin@wasiporck.com / WasiPorck2025!');
    }
    
    // Insertar popup por defecto
    const [popup] = await connection.query('SELECT * FROM popup_bienvenida');
    if (popup.length === 0) {
      await connection.query(`
        INSERT INTO popup_bienvenida (imagen, texto, boton_texto, boton_whatsapp, activo) 
        VALUES (?, ?, ?, ?, ?)
      `, [
        'https://res.cloudinary.com/demo/image/upload/v1/sample',
        'Bienvenido a WasiPorck - La Casa de los Cerditos',
        'Contactar por WhatsApp',
        '51912345678',
        true
      ]);
    }
    
    // Insertar productos de ejemplo
    const [productos] = await connection.query('SELECT * FROM productos LIMIT 1');
    if (productos.length === 0) {
      await connection.query(`
        INSERT INTO productos (tipo, nombre, genero, edad, descripcion, precio, stock) VALUES
        ('cerdo', 'Cerdo Landrace', 'Macho', '3 meses', 'Cerdo de alta calidad genética', 850.00, 5),
        ('cerdo', 'Cerdo Yorkshire', 'Hembra', '2 meses', 'Excelente para reproducción', 950.00, 3),
        ('alimento', 'Iniciador Premium', NULL, NULL, 'Alimento para lechones 0-30 días', 120.00, 50),
        ('alimento', 'Engorde Plus', NULL, NULL, 'Alimento para cerdos de engorde', 98.00, 100),
        ('accesorio', 'Bebedero Automático', NULL, NULL, 'Bebedero de acero inoxidable', 45.00, 30),
        ('seminal', 'Dosis Seminal Landrace', NULL, NULL, 'Dosis de alta calidad genética', 85.00, 20)
      `);
      console.log('✅ Productos de ejemplo creados');
    }
    
    connection.release();
    console.log('✅ Base de datos inicializada');
  } catch (error) {
    console.error('❌ Error en BD:', error.message);
  }
}

// ============ RUTAS PÚBLICAS ============
app.get('/api/productos', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM productos WHERE disponible = true ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/productos/tipo/:tipo', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM productos WHERE tipo = ? AND disponible = true', [req.params.tipo]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/carousel', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM carousel WHERE activo = true ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/popup', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM popup_bienvenida LIMIT 1');
    res.json(rows[0] || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const { nombre, telefono, direccion, total, productos } = req.body;
    const [result] = await pool.query(
      'INSERT INTO pedidos (nombre, telefono, direccion, total, productos) VALUES (?, ?, ?, ?, ?)',
      [nombre, telefono, direccion, total, JSON.stringify(productos)]
    );
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ RUTAS ADMIN ============
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ?', [email]);
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const valid = await bcrypt.compare(password, rows[0].password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/verify', verifyToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.post('/api/admin/productos', verifyToken, upload.single('imagen'), async (req, res) => {
  try {
    let imagenUrl = '';
    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, { folder: 'wasiporck/productos' });
      imagenUrl = result.secure_url;
    }
    
    const { tipo, nombre, genero, edad, etapa, descripcion, precio, stock } = req.body;
    
    await pool.query(
      `INSERT INTO productos (tipo, imagen, nombre, genero, edad, etapa, descripcion, precio, stock) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo, imagenUrl, nombre || null, genero || null, edad || null, etapa || null, descripcion || null, precio, stock || 0]
    );
    
    res.json({ success: true, message: 'Producto creado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/productos/:id', verifyToken, upload.single('imagen'), async (req, res) => {
  try {
    let imagenUrl = req.body.imagen_actual || '';
    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, { folder: 'wasiporck/productos' });
      imagenUrl = result.secure_url;
    }
    
    const { tipo, nombre, genero, edad, etapa, descripcion, precio, stock, disponible } = req.body;
    
    await pool.query(
      `UPDATE productos SET tipo=?, imagen=?, nombre=?, genero=?, edad=?, etapa=?, descripcion=?, precio=?, stock=?, disponible=? WHERE id=?`,
      [tipo, imagenUrl, nombre, genero, edad, etapa, descripcion, precio, stock, disponible === 'true', req.params.id]
    );
    
    res.json({ success: true, message: 'Producto actualizado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/productos/:id', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM productos WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Producto eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/pedidos', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pedidos ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/pedidos/:id/estado', verifyToken, async (req, res) => {
  try {
    const { estado } = req.body;
    await pool.query('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/estadisticas', verifyToken, async (req, res) => {
  try {
    const [productos] = await pool.query('SELECT COUNT(*) as total FROM productos');
    const [pedidos] = await pool.query('SELECT COUNT(*) as total, SUM(total) as ventas FROM pedidos');
    const [pendientes] = await pool.query('SELECT COUNT(*) as total FROM pedidos WHERE estado = "pendiente"');
    res.json({
      totalProductos: productos[0].total,
      totalPedidos: pedidos[0].total,
      ventasTotales: pedidos[0].ventas || 0,
      pedidosPendientes: pendientes[0].total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
  initDB();
});