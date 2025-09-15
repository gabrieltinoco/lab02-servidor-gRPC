const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = { jwtSecret: process.env.JWT_SECRET || 'seu-secret-aqui', jwtExpiration: '24h' };

class User {
    constructor(data) {
        this.id = data.id;
        this.email = data.email;
        this.username = data.username;
        this.password = data.password;
        this.firstName = data.firstName || data.first_name;
        this.lastName = data.lastName || data.last_name;
        this.createdAt = data.createdAt || data.created_at;
    }

    async hashPassword() {
        this.password = await bcrypt.hash(this.password, 12);
    }

    async comparePassword(candidatePassword) {
        return bcrypt.compare(candidatePassword, this.password);
    }

    generateToken() {
        return jwt.sign(
            { id: this.id, email: this.email, username: this.username },
            config.jwtSecret,
            { expiresIn: config.jwtExpiration }
        );
    }

    // Converter para formato Protobuf
    toProtobuf() {
        return {
            id: this.id,
            email: this.email,
            username: this.username,
            first_name: this.firstName,
            last_name: this.lastName,
            created_at: this.createdAt ? Math.floor(new Date(this.createdAt).getTime() / 1000) : 0
        };
    }

    toJSON() {
        const { password, ...user } = this;
        return user;
    }
}

module.exports = User;