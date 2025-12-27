FROM public.ecr.aws/nginx/nginx-unprivileged:alpine

COPY static/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

USER nginx

EXPOSE 8080
