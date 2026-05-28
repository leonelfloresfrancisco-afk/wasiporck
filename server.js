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
app.use(express.static(path.join(__dirname, 'frontend')));

// Cloudinary config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

let pool;

// ============================
// INICIAR BASE DE DATOS
// ============================
async function initDB() {
    try {
        pool = await mysql.createPool({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT || 3306,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_ROOT_PASSWORD,
            database: process.env.MYSQL_DATABASE,
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
                tipo VARCHAR(50) DEFAULT 'general',
                nombre VARCHAR(100) NOT NULL,
                descripcion TEXT,
                precio DECIMAL(10,2) NOT NULL,
                stock INT DEFAULT 0,
                imagen TEXT,
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

        // Crear admin por defecto
        const [admin] = await connection.query(
            'SELECT * FROM admins WHERE email = ?',
            ['admin@wasiporck.com']
        );

        if (admin.length === 0) {
            const passwordHash = await bcrypt.hash('WasiPorck2025!', 10);
            await connection.query(
                'INSERT INTO admins (email, password) VALUES (?, ?)',
                ['admin@wasiporck.com', passwordHash]
            );
            console.log('✅ Admin creado: admin@wasiporck.com / WasiPorck2025!');
        }

        // Insertar productos de ejemplo
        const [productos] = await connection.query('SELECT * FROM productos LIMIT 1');
        if (productos.length === 0) {
            await connection.query(`
                INSERT INTO productos (nombre, descripcion, precio, stock, tipo) VALUES
                ('Cerdo Landrace', 'Cerdo de alta calidad genética', 850.00, 5, 'cerdo'),
                ('Cerdo Yorkshire', 'Excelente para reproducción', 950.00, 3, 'cerdo'),
                ('Iniciador Premium', 'Alimento para lechones 0-30 días', 120.00, 50, 'alimento'),
                ('Engorde Plus', 'Alimento para cerdos de engorde', 98.00, 100, 'alimento'),
                ('Bebedero Automático', 'Bebedero de acero inoxidable', 45.00, 30, 'accesorio'),
                ('Dosis Seminal Landrace', 'Dosis de alta calidad genética', 85.00, 20, 'seminal')
            `);
            console.log('✅ Productos de ejemplo creados');
        }

        connection.release();
        console.log('✅ Base de datos inicializada');

    } catch (error) {
        console.log('❌ Error en BD:', error.message);
    }
}

// ============================
// VERIFICAR TOKEN
// ============================
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Token inválido' });
    }
};

// ============================
// RUTAS PUBLICAS
// ============================

app.get('/api/productos', async (req, res) => {
    try {
        const [productos] = await pool.query(
            'SELECT * FROM productos WHERE disponible = true ORDER BY id DESC'
        );
        res.json(productos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/pedidos', async (req, res) => {
    try {
        const { nombre, telefono, direccion, total, productos } = req.body;
        
        const [result] = await pool.query(
            `INSERT INTO pedidos (nombre, telefono, direccion, total, productos) 
             VALUES (?, ?, ?, ?, ?)`,
            [nombre, telefono, direccion, total, JSON.stringify(productos)]
        );
        
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================
// RUTAS ADMIN
// ============================

app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const [rows] = await pool.query(
            'SELECT * FROM admins WHERE email = ?',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        const validPassword = await bcrypt.compare(password, rows[0].password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        const token = jwt.sign(
            { id: rows[0].id, email: rows[0].email },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({ success: true, token: token });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/verify', verifyToken, async (req, res) => {
    res.json({ success: true, user: req.user });
});

app.get('/api/admin/productos', verifyToken, async (req, res) => {
    try {
        const [productos] = await pool.query('SELECT * FROM productos ORDER BY id DESC');
        res.json(productos);
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

        const { nombre, descripcion, precio, stock, tipo } = req.body;

        await pool.query(
            `INSERT INTO productos (nombre, descripcion, precio, stock, imagen, tipo) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [nombre, descripcion, precio, stock || 0, imagenUrl, tipo || 'general']
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
            const result = await cloudinary.uploader.upload(dataURI, { folder: 'wasiporck' });
            imagenUrl = result.secure_url;
        }

        const { nombre, descripcion, precio, stock, disponible, tipo } = req.body;

        await pool.query(
            `UPDATE productos SET 
                nombre = ?, 
                descripcion = ?, 
                precio = ?, 
                stock = ?, 
                imagen = ?, 
                disponible = ?,
                tipo = ?
             WHERE id = ?`,
            [nombre, descripcion, precio, stock, imagenUrl, disponible === 'true', tipo, req.params.id]
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
        const [pedidos] = await pool.query('SELECT * FROM pedidos ORDER BY id DESC');
        res.json(pedidos);
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
        const [totalProductos] = await pool.query('SELECT COUNT(*) as total FROM productos');
        const [totalPedidos] = await pool.query('SELECT COUNT(*) as total FROM pedidos');
        const [ventasTotales] = await pool.query('SELECT SUM(total) as total FROM pedidos');
        const [pedidosPendientes] = await pool.query('SELECT COUNT(*) as total FROM pedidos WHERE estado = "pendiente"');
        
        res.json({
            totalProductos: totalProductos[0].total,
            totalPedidos: totalPedidos[0].total,
            ventasTotales: ventasTotales[0].total || 0,
            pedidosPendientes: pedidosPendientes[0].total
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================
// PAGINAS FRONTEND
// ============================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'admin.html'));
});

// ============================
// INICIAR SERVIDOR
// ============================
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📱 Frontend: http://localhost:${PORT}`);
    console.log(`🔧 Admin: http://localhost:${PORT}/admin`);
    await initDB();
});