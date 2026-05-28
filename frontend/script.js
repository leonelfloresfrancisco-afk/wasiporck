document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    let carrito = [];

    // --- LÓGICA DE LA TIENDA PÚBLICA (INDEX.HTML) ---
    const contenedorProductos = document.getElementById('contenedor-productos');
    if (contenedorProductos) {
        async function cargarCatalogo() {
            try {
                const res = await fetch('/api/productos');
                const productos = await res.json();
                
                contenedorProductos.innerHTML = productos.map(p => `
                    <div style="border: 1px solid #ddd; padding: 15px; margin: 10px; border-radius: 8px; display: inline-block; width: 250px; vertical-align: top;">
                        <img src="${p.imagen || 'https://via.placeholder.com/150'}" style="width: 100%; height: 180px; object-fit: cover; border-radius: 4px;">
                        <h3>${p.nombre}</h3>
                        <p>${p.descripcion || ''}</p>
                        <p><strong>Precio:</strong> S/. ${p.precio}</p>
                        <button onclick="añadirAlCarrito(${p.id}, '${p.nombre}', ${p.precio})">Agregar al Carrito</button>
                    </div>
                `).join('');
            } catch (err) {
                console.error("Error al cargar productos:", err);
            }
        }

        window.añadirAlCarrito = (id, nombre, precio) => {
            carrito.push({ id, nombre, precio });
            alert(`Añadido: ${nombre} al carrito.`);
        };

        window.enviarPedidoWhatsApp = async (nombre, telefono, direccion) => {
            if (!nombre || !telefono || !direccion) return alert("Por favor, llena todos los datos de envío.");
            if (carrito.length === 0) return alert("El carrito está vacío.");

            const total = carrito.reduce((sum, item) => sum + item.precio, 0);

            try {
                const res = await fetch('/api/pedidos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, telefono, direccion, total, productos: carrito })
                });
                const data = await res.json();
                
                if (data.success) {
                    // Armar mensaje para WhatsApp
                    let mensaje = `🐷 *NUEVO PEDIDO - WASIPORCK* 🐷\n\n`;
                    mensaje += `*Cliente:* ${nombre}\n*Celular:* ${telefono}\n*Dirección:* ${direccion}\n\n`;
                    mensaje += `*Productos:*\n`;
                    carrito.forEach(i => mensaje += `- ${i.nombre} (S/. ${i.precio})\n`);
                    mensaje += `\n*Total:* S/. ${total}`;

                    const urlUrl = `https://api.whatsapp.com/send?phone=51900000000&text=${encodeURIComponent(mensaje)}`;
                    carrito = [];
                    window.open(urlUrl, '_blank');
                }
            } catch (err) {
                alert("Error al procesar el pedido.");
            }
        };

        cargarCatalogo();
    }

    // --- LÓGICA DEL PANEL ADMINISTRATIVO (ADMIN.HTML) ---
    const loginForm = document.getElementById('box-login-admin');
    const crudForm = document.getElementById('box-crud-admin');

    if (loginForm && crudForm) {
        if (token) {
            loginForm.style.display = 'none';
            crudSection.style.display = 'block'; // Muestra el panel directamente
        }

        window.loginAdmin = async (email, password) => {
            try {
                const res = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();
                if (data.success) {
                    localStorage.setItem('token', data.token);
                    window.location.reload();
                } else {
                    alert(data.error || "Datos incorrectos");
                }
            } catch (err) {
                console.error(err);
            }
        };

        window.registrarProductoForm = async (formulario) => {
            const formData = new FormData(formulario);
            try {
                const res = await fetch('/api/admin/productos', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    alert("¡Producto y foto subidos a Cloudinary con éxito!");
                    formulario.reset();
                } else {
                    alert(data.error);
                }
            } catch (err) {
                alert("Error al conectar con el servidor.");
            }
        };
    }
});
