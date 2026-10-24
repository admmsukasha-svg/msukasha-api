// Shared toJSON: expose "id" instead of "_id"/"__v" (the frontend reads id / _id).
module.exports = function applyJSON(schema, extraHidden = []) {
  schema.set('toJSON', {
    transform: (doc, ret) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      extraHidden.forEach((k) => delete ret[k]);
      return ret;
    }
  });
};
