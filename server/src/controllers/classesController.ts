import { Request, Response } from 'express'

import db from '../database/connetion';
import convertHourToMinutes from '../Utils/convertHourToMinutes';
import convertMinutesToHour from '../Utils/convertMinutesToHour';
import convertMinutesToTime from '../Utils/convertMinutesToTime';

interface ScheduleItem {
    id: number,
    week_day: number,
    from: string,
    to: string
}

export default class ClassesController {
    async index(request: Request, response: Response) {
        const query = request.query;

        const subject = query.subject as string;
        const week_day = query.week_day as string;
        const time = query.time as string;
        let page = parseInt(query.page as string);
        let limit = parseInt(query.limit as string);

        let filtered = (week_day != undefined && subject != undefined && time != undefined);
        let timeInMinutes = 0;

        if (filtered) {
            if (!week_day || !subject || !time) {
                return response.status(400).json({
                    error: 'Missing filters to search classes'
                })
            }

            timeInMinutes = convertHourToMinutes(time);
        }

        if (!limit && !page) {
            page = 0
            limit = 1;
        }

        try {
            const classes = filtered ? await db('classes')
                .whereExists(function () {
                    this.select('class_schedule.*')
                        .from('class_schedule')
                        .whereRaw('`class_schedule`.`class_id` = `classes`.`id`')
                        .whereRaw('`class_schedule`.`week_day` = ??', [Number(week_day)])
                        .whereRaw('`class_schedule`.`from` <= ??', [timeInMinutes])
                        .whereRaw('`class_schedule`.`to` > ??', [timeInMinutes])
                })
                .where('classes.subject', '=', subject)
                .offset(page)
                .limit(limit)
                .join('perfis', 'classes.perfil_id', '=', 'perfis.id')
                .join('users', 'perfis.user_id', '=', 'users.id')
                .select(['classes.*', 'perfis.*', 'users.name', 'users.surname', 'users.email'])
                : // Caso não tenha filtro
                await db('classes')
                    .offset(page)
                    .limit(limit)
                    .join('perfis', 'classes.perfil_id', '=', 'perfis.id')
                    .join('users', 'perfis.user_id', '=', 'users.id')
                    .select(['classes.*', 'perfis.*', 'users.name', 'users.surname', 'users.email']);

            const classSchedule = await db('class_schedule')
                .where((builder) => {
                    builder.whereIn('class_schedule.class_id', classes.map(x => x.id))
                })
                .select('class_schedule.*');

            const classesReturn = classes.map(x => ({
                ...x,
                class_schedule: classSchedule.filter(y => y.class_id == x.id).map(y => ({ week_day: y.week_day, from: convertMinutesToHour(y.from), to: convertMinutesToHour(y.to) }))
            }));

            return response.json(classesReturn);
        } catch (err) {
            return response.status(400).json({
                error: 'Unexpected error while listing classes'
            });
        }
    }

    async create(request: Request, response: Response) {
        const {
            user_id,
            avatar,
            whatsapp,
            bio,
            subject,
            cost,
            schedule
        } = request.body

        const trx = await db.transaction();

        try {
            const insertedPerfisIds = await trx('perfis').insert({
                user_id,
                avatar,
                whatsapp,
                bio
            });

            const perfil_id = insertedPerfisIds[0];

            const insertedClassesIds = await trx('classes').insert({
                subject,
                cost,
                perfil_id,
            })

            const class_id = insertedClassesIds[0];

            const classSchecule = schedule.map((scheduleItem: ScheduleItem) => {
                scheduleItem.week_day

                return {
                    class_id,
                    week_day: scheduleItem.week_day,
                    from: convertHourToMinutes(scheduleItem.from),
                    to: convertHourToMinutes(scheduleItem.to),
                };
            });

            await trx('class_schedule').insert(classSchecule);

            await trx.commit();

            return response.status(201).send();
        } catch (err) {
            await trx.rollback();

            return response.status(400).json({
                error: 'Unexpected error while creating new class'
            });
        }
    }

    async getByUserId(request: Request, response: Response) {
        const params = request.params;

        let user_id = parseInt(params.user_id as string);

        if (!user_id) {
            return response.status(400).json({
                error: 'Missing user_id to get class'
            });
        }

        try {
            const userClass: any = await db('perfis')
                .where({ user_id })
                .join('classes', 'perfis.id', '=', 'classes.perfil_id')
                .join('users', 'perfis.user_id', '=', 'users.id')
                .select(['classes.*', 'perfis.*', 'users.name', 'users.surname', 'users.email', 'perfis.avatar'])
                .first();

            const classSchedule = await db('class_schedule')
                .where('class_schedule.class_id', userClass.id)
                .select('class_schedule.*');

            const classesReturn = {
                ...userClass,
                class_schedule: classSchedule.map(y => ({ id: y.id, week_day: y.week_day, from: convertMinutesToTime(y.from), to: convertMinutesToTime(y.to) }))
            };

            response.json(classesReturn);
        }
        catch (err) {
            return response.status(400).json({
                error: 'Unexpected error while get class'
            });
        }
    }

    async update(request: Request, response: Response) {
        const {
            name,
            surname,
            email,
            avatar,
            whatsapp,
            bio,
            subject,
            cost,
            schedule
        } = request.body

        const {
            user_id
        } = request.params;

        const trx = await db.transaction();

        try {
            // Atualiza o usuário
            await trx('users')
                .where('users.id', '=', user_id)
                .update({
                    name,
                    surname,
                    email
                });

            // Atualiza o perfil
            await trx('perfis')
                .where({ user_id })
                .update({
                    avatar,
                    whatsapp,
                    bio
                });

            // Busca o perfil
            const { id: perfil_id } = await trx('perfis')
                .where({ user_id })
                .first()
                .select('perfis.id')

            // Atualiza a classe
            await trx('classes')
                .where({ perfil_id })
                .update({
                    subject,
                    cost
                });

            // Busca a classe
            const { id: class_id } = await trx('classes')
                .where({ perfil_id })
                .first()
                .select('classes.id');

            // Busca os schedules da class
            const schedulesItems = await trx('class_schedule')
                .where({ class_id })
                .select('class_schedule.id') as Array<ScheduleItem>;

            // Filtra os schedules
            const schedulesEdit = schedule.filter((x: ScheduleItem) => x.id != 0) as Array<ScheduleItem>;
            const schedulesRemove = schedulesItems.filter(x => !schedulesEdit.some(y => y.id == x.id));
            const schedulesNews = schedule.filter((x: ScheduleItem) => x.id == 0) as Array<ScheduleItem>;

            // Edita os schedules
            if (schedulesEdit.length != 0) {
                for (let i = 0; i < schedulesEdit.length; i++) {
                    let se = schedulesEdit[i];

                    await trx('class_schedule')
                        .where('class_schedule.id', '=', se.id)
                        .update({
                            week_day: se.week_day,
                            from: convertHourToMinutes(se.from),
                            to: convertHourToMinutes(se.to),
                        });
                }
            }

            // Remove os schedules
            if (schedulesRemove.length != 0) {
                await trx('class_schedule')
                    .where((builder) => {
                        builder.whereIn('class_schedule.id', schedulesRemove.map(x => x.id))
                    })
                    .del();
            }

            // Adiciona um novo schedule
            if (schedulesNews.length != 0) {
                const classSchecule = schedule.map((scheduleItem: ScheduleItem) => {
                    scheduleItem.week_day

                    return {
                        class_id,
                        week_day: scheduleItem.week_day,
                        from: convertHourToMinutes(scheduleItem.from),
                        to: convertHourToMinutes(scheduleItem.to),
                    };
                });

                await trx('class_schedule').insert(classSchecule);
            }

            await trx.commit();

            return response.status(200).send();
        } catch (err) {
            await trx.rollback();

            return response.status(400).json({
                error: 'Unexpected error while creating new class'
            });
        }
    }

    async getFavorites(request: Request, response: Response) {
        const query = request.query;

        let user_id = parseInt(query.user_id as string);

        if (!user_id) {
            return response.status(400).json({
                error: 'Missing user_id to search favorite classes'
            });
        }

        let page = parseInt(query.page as string);
        let limit = parseInt(query.limit as string);

        if (!limit && !page) {
            page = 0
            limit = 5;
        }

        try {
            const favorites = await db('favorites')
                .where({ user_id })
                .offset(page)
                .limit(limit)
                .select('class_id');

            const favoritesIds = favorites.map(x => x.class_id);

            const classes = await db('classes')
                .where((builder) => {
                    builder.whereIn('classes.id', favoritesIds)
                })
                .offset(page)
                .limit(limit)
                .join('perfis', 'classes.perfil_id', '=', 'perfis.id')
                .join('users', 'perfis.user_id', '=', 'users.id')
                .select(['classes.*', 'perfis.*', 'users.name', 'users.surname', 'users.email']);

            const classSchedule = await db('class_schedule')
                .where((builder) => {
                    builder.whereIn('class_schedule.class_id', classes.map(x => x.id))
                })
                .select('class_schedule.*');

            const classesReturn = classes.map(x => ({
                ...x,
                class_schedule: classSchedule.filter(y => y.class_id == x.id).map(y => ({ week_day: y.week_day, from: y.from, to: y.to }))
            }));

            return response.json(classesReturn);
        } catch (err) {
            return response.status(400).json({
                error: 'Unexpected error while listing favorite classes'
            });
        }
    }
}