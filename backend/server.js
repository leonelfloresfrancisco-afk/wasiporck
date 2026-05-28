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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

// ============ VERIFICAR TOKEN ============
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

// ============ INICIAR BASE DE DATOS ============
async function initDB() {
  const conn = await pool.getConnection();
  
  await conn.query(`CREATE TABLE IF NOT EXISTS admins (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
  )`);
  
  await conn.query(`CREATE TABLE IF NOT EXISTS productos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    tipo ENUM('cerdo','alimento','accesorio','seminal') NOT NULL,
    imagen VARCHAR(500),
    nombre VARCHAR(100),
    genero VARCHAR(20),
    edad VARCHAR(50),
    etapa VARCHAR(50),
    descripcion TEXT,
    precio DECIMAL(10,2) NOT NULL,
    stock INT DEFAULT 0,
    disponible BOOLEAN DEFAULT true
  )`);
  
  await conn.query(`CREATE TABLE IF NOT EXISTS pedidos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    direccion TEXT NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    productos TEXT NOT NULL,
    estado VARCHAR(50) DEFAULT 'pendiente',
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  
  await conn.query(`CREATE TABLE IF NOT EXISTS carousel (
    id INT PRIMARY KEY AUTO_INCREMENT,
    imagen VARCHAR(500) NOT NULL,
    titulo VARCHAR(200),
    activo BOOLEAN DEFAULT true
  )`);
  
  await conn.query(`CREATE TABLE IF NOT EXISTS popup_bienvenida (
    id INT PRIMARY KEY AUTO_INCREMENT,
    imagen VARCHAR(500),
    texto TEXT,
    boton_texto VARCHAR(100),
    boton_whatsapp VARCHAR(20),
    activo BOOLEAN DEFAULT false
  )`);
  
  // Admin por defecto
  const [admins] = await conn.query('SELECT * FROM admins WHERE email = "admin@wasiporck.com"');
  if (admins.length === 0) {
    const hash = await bcrypt.hash('WasiPorck2025!', 10);
    await conn.query('INSERT INTO admins (email, password) VALUES (?, ?)', ['admin@wasiporck.com', hash]);
  }
  
  // Popup por defecto
  const [popup] = await conn.query('SELECT * FROM popup_bienvenida');
  if (popup.length === 0) {
    await conn.query(`INSERT INTO popup_bienvenida (imagen, texto, boton_texto, boton_whatsapp, activo) 
      VALUES (?, ?, ?, ?, ?)`, ['https://res.cloudinary.com/demo/image/upload/v1/sample', 'Bienvenido a WasiPorck - La Casa de los Cerditos', 'Contactar por WhatsApp', '51912345678', true]);
  }
  
  conn.release();
  console.log('✅ Base de datos lista');
}

initDB();

// ============ RUTAS PÚBLICAS ============
app.get('/api/productos', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM productos WHERE disponible = true ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/productos/:tipo', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM productos WHERE tipo = ? AND disponible = true', [req.params.tipo]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/carousel', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM carousel WHERE activo = true');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/popup', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM popup_bienvenida LIMIT 1');
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PEDIDOS ============
app.post('/api/pedidos', async (req, res) => {
  try {
    const { nombre, telefono, direccion, total, productos } = req.body;
    const [result] = await pool.query(
      'INSERT INTO pedidos (nombre, telefono, direccion, total, productos) VALUES (?, ?, ?, ?, ?)',
      [nombre, telefono, direccion, total, JSON.stringify(productos)]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ RUTAS ADMIN ============
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ?', [email]);
    if (rows.length === 0) return res.status(401).json({ error: 'Credenciales inválidas' });
    
    const valid = await bcrypt.compare(password, rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });
    
    const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/productos', verifyToken, upload.single('imagen'), async (req, res) => {
  try {
    let imagenUrl = '';
    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, { folder: 'wasiporck' });
      imagenUrl = result.secure_url;
    }
    
    const { tipo, nombre, genero, edad, etapa, descripcion, precio, stock } = req.body;
    await pool.query(
      'INSERT INTO productos (tipo, imagen, nombre, genero, edad, etapa, descripcion, precio, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [tipo, imagenUrl, nombre || null, genero || null, edad || null, etapa || null, descripcion || null, precio, stock || 0]
    );
    res.json({ success: true, message: 'Producto creado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/productos/:id', verifyToken, upload.single('imagen'), async (req, res) => {
  try {
    let imagenUrl = req.body.imagen_actual || '';
    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, { folder: 'wasiporck' });
      imagenUrl = result.secure_url;
    }
    
    const { tipo, nombre, genero, edad, etapa, descripcion, precio, stock, disponible } = req.body;
    await pool.query(
      'UPDATE productos SET tipo=?, imagen=?, nombre=?, genero=?, edad=?, etapa=?, descripcion=?, precio=?, stock=?, disponible=? WHERE id=?',
      [tipo, imagenUrl, nombre, genero, edad, etapa, descripcion, precio, stock, disponible !== 'false', req.params.id]
    );
    res.json({ success: true, message: 'Producto actualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/productos/:id', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM productos WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/pedidos', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pedidos ORDER BY fecha DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/pedidos/:id/estado', verifyToken, async (req, res) => {
  try {
    const { estado } = req.body;
    await pool.query('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/carousel', verifyToken, upload.single('imagen'), async (req, res) => {
  try {
    let imagenUrl = '';
    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, { folder: 'wasiporck/carousel' });
      imagenUrl = result.secure_url;
    }
    const { titulo } = req.body;
    await pool.query('INSERT INTO carousel (imagen, titulo) VALUES (?, ?)', [imagenUrl, titulo]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/carousel/:id', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM carousel WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/popup', verifyToken, upload.single('imagen'), async (req, res) => {
  try {
    let imagenUrl = req.body.imagen_actual || '';
    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, { folder: 'wasiporck/popup' });
      imagenUrl = result.secure_url;
    }
    const { texto, boton_texto, boton_whatsapp, activo } = req.body;
    await pool.query(
      'UPDATE popup_bienvenida SET imagen=?, texto=?, boton_texto=?, boton_whatsapp=?, activo=? WHERE id=1',
      [imagenUrl, texto, boton_texto, boton_whatsapp, activo === 'true']
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/estadisticas', verifyToken, async (req, res) => {
  try {
    const [productos] = await pool.query('SELECT COUNT(*) as total FROM productos');
    const [pedidos] = await pool.query('SELECT COUNT(*) as total, SUM(total) as ventas FROM pedidos');
    const [pedidosPendientes] = await pool.query('SELECT COUNT(*) as pendientes FROM pedidos WHERE estado = "pendiente"');
    res.json({
      totalProductos: productos[0].total,
      totalPedidos: pedidos[0].total,
      ventasTotales: pedidos[0].ventas || 0,
      pedidosPendientes: pedidosPendientes[0].pendientes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
