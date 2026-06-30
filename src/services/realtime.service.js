export function emitToUser(req, userId, event, payload) {
  req.app.get('io')?.to(`user:${userId}`).emit(event, payload);
}

export function emitToClassroom(req, classroomId, event, payload) {
  req.app.get('io')?.to(`classroom:${classroomId}`).emit(event, payload);
}

export function emitNotification(req, notification) {
  emitToUser(req, String(notification.recipient), 'notification:new', { notification });
}