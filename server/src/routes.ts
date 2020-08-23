import express from 'express';
import authMiddlewere from './middlewares/auth';

import ClassesController from './controllers/classesController';
import ConnectionsController from './controllers/connectionsController';
import FavoritesController from './controllers/favoritesController';
import UsersController from './controllers/usersController';

const routes = express.Router();
const classesControllers = new ClassesController();
const connectionsControllers = new ConnectionsController();
const favoritesController = new FavoritesController();
const usersController = new UsersController();

routes.post('/users', usersController.create);
routes.post('/login', usersController.login);

routes.use(authMiddlewere);

routes.get('/classes', classesControllers.index);
routes.post('/classes', classesControllers.create);
routes.get('/classes/favorites', classesControllers.getFavorites);

routes.post('/favorites', favoritesController.create);
routes.delete('/favorites', favoritesController.delete);

routes.get('/connections', connectionsControllers.index);
routes.post('/connections', connectionsControllers.create);


export default routes;