FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder

# Set the working directory inside the container
WORKDIR /headlamp-plugins

# Add a build argument for the desired plugin to be built
ARG PLUGIN

# Check if the PLUGIN argument is provided
RUN if [ -z "$PLUGIN" ]; then \
      echo "Error: PLUGIN argument is required"; \
      exit 1; \
    fi

# Remove any existing node_modules and package-lock.json to avoid arch-specific conflicts
COPY package.json package-lock.json /headlamp-plugins/${PLUGIN}/

# Install dependencies for the specified plugin
RUN --mount=type=cache,target=/root/.npm \
    echo "Installing deps for plugin $PLUGIN..."; \
    cd /headlamp-plugins/${PLUGIN}; \
    npm ci

# Create a directory for the plugin build    
COPY . /headlamp-plugins/${PLUGIN}

# Build the specified plugin
RUN echo "Building plugin $PLUGIN..."; \
    cd /headlamp-plugins/${PLUGIN}; \
    npm run build

# Extract the built plugin to the build directory
RUN mkdir -p /headlamp-plugins/build && \
    echo "Extracting plugin ${PLUGIN}..." && \
    cd "/headlamp-plugins/${PLUGIN}" && \
    npx --no-install headlamp-plugin extract . "/headlamp-plugins/build/${PLUGIN}"

FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS final

# Create a non-root user and group
RUN addgroup -S headlamp && adduser -S headlamp -G headlamp

# Copy the built plugin files from the builder stage to the /plugins directory in the final image
COPY --from=builder /headlamp-plugins/build/ /plugins/

# Set appropriate permissions for the plugins directory
RUN chown -R headlamp:headlamp /plugins && \
    chmod -R 755 /plugins

LABEL org.opencontainers.image.source=https://github.com/cloudnative-pg/cnpg-headlamp-plugin
LABEL org.opencontainers.image.licenses=Apache-2.0

# Switch to non-root user
USER headlamp

# Set the default command to list the installed plugins
CMD ["sh", "-c", "echo Plugins installed at /plugins/:; ls /plugins/"]