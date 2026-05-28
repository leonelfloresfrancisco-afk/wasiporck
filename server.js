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

// Servir archivos estáticos desde la carpeta frontend
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Configuración de Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

let pool;

// Inicialización de la Base de Datos en Railway
async function initDB() {
    try {
        pool = await mysql.createPool({
            host: process.env.MYSQL_HOST,
            port: parseInt(process.env.MYSQL_PORT) || 3306,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_ROOT_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        const connection = await pool.getConnection();
        console.log('✅ Conexión exitosa a MySQL en Railway');

        // Tabla admins
        await connection.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id INT PRIMARY KEY AUTO_INCREMENT,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL
            )
        `);

        // Tabla productos completa
        await connection.query(`
            CREATE TABLE IF NOT EXISTS productos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                tipo VARCHAR(50) DEFAULT 'general',
                nombre VARCHAR(100) NOT NULL,
                descripcion TEXT,
                precio DECIMAL(10,2) NOT NULL,
                stock INT DEFAULT 0,
                imagen TEXT,
                disponible BOOLEAN DEFAULT true,
                genero VARCHAR(50),
                edad VARCHAR(50),
                etapa VARCHAR(50)
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
                productos TEXT NOT NULL
            )
        `);

        // Crear administrador base si no existe
        const [admin] = await connection.query('SELECT * FROM admins WHERE email = ?', ['admin@wasiporck.com']);
        if (admin.length === 0) {
            const hash = await bcrypt.hash('WasiPorck2025!', 10);
            await connection.query('INSERT INTO admins (email, password) VALUES (?, ?)', ['admin@wasiporck.com', hash]);
            console.log('✅ Administrador base verificado: admin@wasiporck.com');
        }

        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Error en Base de Datos:', error.message);
        return false;
    }
}

// Middleware de autenticación (JWT)
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Acceso denegado' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Token inválido' });
    }
};

// --- ENDPOINTS PÚBLICOS ---
app.get('/api/productos', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM productos WHERE disponible = true ORDER BY id DESC');
        res.json(rows);
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

// --- ENDPOINTS ADMINISTRATIVOS ---
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [rows] = await pool.query('SELECT * FROM admins WHERE email = ?', [email]);
        if (rows.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas' });
        
        const valid = await bcrypt.compare(password, rows[0].password);
        if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });
        
        const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ success: true, token });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
        const { nombre, descripcion, precio, stock, tipo, genero, edad, etapa } = req.body;
        await pool.query(
            `INSERT INTO productos (nombre, descripcion, precio, stock, imagen, tipo, genero, edad, etapa) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [nombre, descripcion, precio, stock || 0, imagenUrl, tipo, genero || null, edad || null, etapa || null]
        );
        res.json({ success: true, message: 'Guardado con éxito' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENRUTAMIENTO DE PÁGINAS (Sintaxis universal limpia para Express v5) ---
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'admin.html'));
});

app.get('/:path*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Inicializar Servidor de forma segura
async function start() {
    if (await initDB()) {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Servidor WasiPorck ejecutándose en el puerto ${PORT}`);
        });
    }
}
start();