import mongoose from 'mongoose';

const systemConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  description: { type: String, trim: true, maxlength: 300 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('SystemConfig', systemConfigSchema);