const Notification = require("./models/Notification");

class NotificationRepository {
  async create(data) {
    return await Notification.create(data);
  }

  async findByUserId(userId) {
    return await Notification.find({ userId }).sort({ createdAt: -1 });
  }

  async findById(id) {
    return await Notification.findById(id);
  }

  async markAsRead(id) {
    return await Notification.findByIdAndUpdate(
      id,
      { read: true },
      { new: true }
    );
  }

  async countUnread(userId) {
    return await Notification.countDocuments({ userId, read: false });
  }
}

module.exports = new NotificationRepository();
